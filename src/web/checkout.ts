import { Router } from "express";
import QRCode from "qrcode";
import { Invoice, TxgateError } from "../services/types";
import { badgeClass, formatAmount } from "./format";
import { requireId, route } from "./http";
import { WebServices } from "./types";

function checkoutAmount(amount: string, invoice: Invoice): string {
  const { assetSymbol, decimals } = invoice;
  const precision = ["USDC", "USDT"].includes(assetSymbol) ? Math.min(2, decimals) : decimals;
  return formatAmount(amount, decimals, precision);
}

function checkoutStatus(invoice: Invoice) {
  const { status, confirmations, targetConfirmations, remaining, assetSymbol, expiresAt } = invoice;
  const message = {
    NEW: "Waiting for payment",
    DETECTED: `Payment detected (${confirmations}/${targetConfirmations} blocks)`,
    CONFIRMING: `Confirming (${confirmations}/${targetConfirmations} blocks)`,
    SETTLED: "Paid",
    OVERPAID: "Paid (overpayment recorded)",
    UNDERPAID: `${checkoutAmount(remaining, invoice)} ${assetSymbol} remaining`,
    EXPIRED: "Expired",
    LATE_PAYMENT: "Paid after expiry. Contact the merchant.",
    REORGED: "Payment removed by chain reorganization"
  }[status];
  const payable = Date.parse(expiresAt) > Date.now() && ["NEW", "UNDERPAID", "REORGED"].includes(status);
  return { status, confirmations, targetConfirmations, remaining, expiresAt, message, payable, badge: badgeClass(status) };
}

export function createCheckout(services: WebServices): Router {
  const checkout = Router();

  checkout.get("/v1/public/invoices/:id/status", route(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const invoice = await services.getInvoice(requireId(req.params.id));
    if (!invoice) throw new TxgateError(404, "Invoice not found");
    res.json(checkoutStatus(invoice));
  }));

  checkout.get("/pay/:id", route(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const invoice = await services.getInvoice(requireId(req.params.id));
    if (!invoice) throw new TxgateError(404, "Invoice not found");
    const qr = await QRCode.toString(invoice.address, { type: "svg", width: 192, margin: 2 });
    res.render("checkout", {
      title: "Pay invoice",
      invoice,
      qr,
      status: checkoutStatus(invoice),
      amount: checkoutAmount(invoice.amount, invoice)
    });
  }));

  return checkout;
}
