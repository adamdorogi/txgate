import { randomBytes } from "crypto";
import express, { Router } from "express";
import Joi from "joi";
import { invoiceStatuses, TxgateError } from "../services/types";
import { parseAmount } from "./format";
import { requireId, route, secretMatches } from "./http";
import { WebServices } from "./types";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    csrfToken?: string;
  }
}

export const sessionName = "txgate.sid";

const invoiceForm = Joi.object({
  csrf: Joi.string().required(),
  asset: Joi.string().max(200).required(),
  amount: Joi.string().max(100).required(),
  ttlSeconds: Joi.number().integer().positive().empty(""),
  sku: Joi.string().trim().max(128).empty("")
});

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function assetKey(chain: string, id: string): string {
  return `${chain}:${id}`;
}

export function adminCookie(secure: boolean) {
  return { path: "/admin", maxAge: 8 * 60 * 60 * 1000, sameSite: "lax" as const, httpOnly: true, secure };
}

export function createAdmin(services: WebServices, adminPassword: string, secureCookies: boolean): Router {
  const admin = Router();
  admin.use(express.urlencoded({ extended: false, limit: "48kb" }));
  admin.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.locals.authenticated = Boolean(req.session.authenticated);
    if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString("hex");
    res.locals.csrf = req.session.csrfToken;
    if (req.method === "POST" && !secretMatches(req.body?.csrf, req.session.csrfToken)) {
      next(new TxgateError(403, "Form expired. Reload the page and try again."));
      return;
    }
    next();
  });

  admin.get("/login", (req, res) => {
    if (req.session.authenticated) {
      res.redirect("/admin/invoices");
      return;
    }
    res.render("login", { title: "Sign in", error: null });
  });

  admin.post("/login", (req, res, next) => {
    if (!secretMatches(req.body.password, adminPassword)) {
      res.status(401).render("login", { title: "Sign in", error: "Incorrect password" });
      return;
    }
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.authenticated = true;
      req.session.csrfToken = randomBytes(32).toString("hex");
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.redirect(303, "/admin/invoices");
      });
    });
  });

  admin.use((req, res, next) => {
    if (req.session.authenticated) return next();
    res.redirect(303, "/admin/login");
  });

  admin.post("/logout", (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      const { maxAge, ...cookie } = adminCookie(secureCookies);
      res.clearCookie(sessionName, cookie).redirect(303, "/admin/login");
    });
  });

  admin.get("/", (_req, res) => res.redirect("/admin/invoices"));

  admin.get("/invoices", route(async (req, res) => {
    const assets = services.listAssets();
    const filterAssets = new Map<string, Set<string>>();
    for (const { id, symbol } of assets) {
      const symbols = filterAssets.get(id) || new Set<string>();
      symbols.add(symbol);
      filterAssets.set(id, symbols);
    }
    const filter = {
      chain: asString(req.query.chain),
      assetId: asString(req.query.assetId),
      status: asString(req.query.status)
    };
    res.render("invoices", {
      title: "Invoices",
      invoices: await services.listInvoices(filter),
      assets, assetKey, invoiceStatuses, filter, filterAssets,
      chains: [...new Set(assets.map((asset) => asset.chain))]
    });
  }));

  admin.post("/invoices", route(async (req, res) => {
    const { error, value } = invoiceForm.validate(req.body);
    if (error) throw new TxgateError(400, error.details[0].message);
    const selected = services.listAssets().find((asset) => assetKey(asset.chain, asset.id) === value.asset);
    if (!selected) throw new TxgateError(400, "Unknown asset");
    const amount = parseAmount(value.amount, selected.decimals);
    if (!amount) throw new TxgateError(400, "Enter a positive amount with the asset's supported decimal places");
    const invoice = await services.createInvoice({
      chain: selected.chain, assetId: selected.id, amount,
      ttlSeconds: value.ttlSeconds, sku: value.sku
    });
    res.redirect(303, `/admin/invoices/${invoice.id}`);
  }));

  admin.get("/invoices/:id", route(async (req, res) => {
    const detail = await services.invoiceDetail(requireId(req.params.id));
    if (!detail) throw new TxgateError(404, "Invoice not found");
    res.render("invoice", { title: "Invoice", ...detail, resend: req.query.resend === "queued" });
  }));

  admin.post("/invoices/:id/webhooks/:deliveryId/resend", route(async (req, res) => {
    const id = requireId(req.params.id);
    const resent = await services.resendWebhook(id, requireId(req.params.deliveryId));
    if (!resent) throw new TxgateError(404, "Webhook delivery not found");
    res.redirect(303, `/admin/invoices/${id}?resend=queued`);
  }));

  admin.get("/sweeps", route(async (req, res) => {
    const chains = [...new Set(services.listAssets().map((asset) => asset.chain))];
    const chain = asString(req.query.chain) || chains[0];
    const refund = req.query.mode === "refund";
    if (chain && !chains.includes(chain)) throw new TxgateError(400, "Unknown chain");
    res.render("sweeps", {
      title: "Sweeps", chains, chain, refund, destination: "", selected: [],
      candidates: chain ? await services.listSweepCandidates(chain, refund) : [], result: null
    });
  }));

  admin.post("/sweeps", route(async (req, res) => {
    const chains = [...new Set(services.listAssets().map((asset) => asset.chain))];
    const chain = asString(req.body.chain);
    const destination = asString(req.body.destination).trim();
    const refund = req.body.mode === "refund";
    if (!chains.includes(chain)) throw new TxgateError(400, "Unknown chain");
    if ((chain === "cardano" && !destination) || destination.length > 256) {
      throw new TxgateError(400, "Enter a destination address");
    }
    const ids = req.body.invoiceIds;
    const selected = [...new Set(Array.isArray(ids) ? ids : ids ? [ids] : [])];
    if (!selected.length) throw new TxgateError(400, "Select at least one invoice");
    const invoiceIds = selected.map(requireId);
    const result = await services.buildSweep({ chain, invoiceIds, destination, refund });
    res.render("sweeps", {
      title: "Sweeps", chains, chain, refund, destination, selected: invoiceIds,
      candidates: await services.listSweepCandidates(chain, refund), result
    });
  }));

  admin.get("/chains", route(async (_req, res) => {
    res.render("chains", {
      title: "Chains", chains: await services.chainHealth(), merchantSettings: services.settings()
    });
  }));

  return admin;
}
