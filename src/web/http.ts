import { createHash, timingSafeEqual } from "crypto";
import { Request, RequestHandler, Response } from "express";
import { TxgateError } from "../services/types";

export function route(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function secretMatches(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string" || !expected) return false;
  const actualHash = createHash("sha256").update(candidate).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

export function requireId(id: string): string {
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
    throw new TxgateError(404, "Invoice or delivery not found");
  }
  return id;
}

export function stringifyBigInts(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
