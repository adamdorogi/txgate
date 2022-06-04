import express, { Router } from "express";
import Joi from "joi";
import { TxgateError } from "../services/types";
import { requireId, route, secretMatches } from "./http";
import { WebServices } from "./types";

const createSchema = Joi.object({
  chain: Joi.string().max(32).required(),
  assetId: Joi.string().max(160).required(),
  amount: Joi.string().pattern(/^[1-9]\d{0,77}$/).required(),
  ttlSeconds: Joi.number().integer().positive(),
  sku: Joi.string().max(128)
}).strict().required();

export function createApi(services: WebServices, apiKey: string): Router {
  const api = Router();
  api.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const bearer = /^Bearer ([^\s]+)$/i.exec(req.get("authorization") || "");
    if (!secretMatches(bearer?.[1], apiKey)) {
      res.set("WWW-Authenticate", "Bearer").status(401).json({ error: "API key required" });
      return;
    }
    next();
  });

  api.get("/invoices/:id", route(async (req, res) => {
    const invoice = await services.getInvoice(requireId(req.params.id));
    if (!invoice) throw new TxgateError(404, "Invoice not found");
    res.json(invoice);
  }));

  api.post("/invoices", express.json({ limit: "16kb" }), route(async (req, res) => {
    if (!req.is("application/json")) throw new TxgateError(415, "Send application/json");
    const { error, value } = createSchema.validate(req.body);
    if (error) throw new TxgateError(400, error.details[0].message);
    const invoice = await services.createInvoice(value);
    const payUrl = `/pay/${invoice.id}`;
    res.location(`/v1/invoices/${invoice.id}`).status(201).json({ ...invoice, payUrl });
  }));

  return api;
}
