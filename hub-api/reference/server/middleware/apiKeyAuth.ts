import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.slice(7);
      const secret = process.env.SESSION_SECRET;
      if (!secret) {
        return res.status(500).json({ message: "SESSION_SECRET não configurado" });
      }
      const decoded = jwt.verify(token, secret) as any;
      (req as any).user = decoded;
      return next();
    } catch {
      return res.status(401).json({ message: "Token inválido ou expirado" });
    }
  }

  const apiKey = (req.headers["x-api-key"] as string) || (req.query.apikey as string) || undefined;

  if (!apiKey) {
    return res.status(401).json({ message: "Autenticação necessária" });
  }

  const validKeys = (process.env.API_KEYS || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (!validKeys.includes(apiKey)) {
    return res.status(401).json({ message: "API key inválida" });
  }

  next();
}
