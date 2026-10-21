import { Express } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db";

const JWT_SECRET = process.env.SESSION_SECRET || "REDACTED_CREDENTIAL_CONFIGURE_ENV";
const JWT_EXPIRATION = "7d";

export function getJwtSecret() {
  return JWT_SECRET;
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Usuário e senha são obrigatórios" });
      }

      const result = await pool.query(
        "SELECT * FROM api_users WHERE username = $1 AND active = true",
        [username]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ message: "Credenciais inválidas" });
      }

      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        return res.status(401).json({ message: "Credenciais inválidas" });
      }

      const token = jwt.sign(
        { userId: user.id, username: user.username, name: user.name },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRATION }
      );

      res.json({
        token,
        user: { id: user.id, username: user.username, name: user.name },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Token não fornecido" });
      }

      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, JWT_SECRET) as any;

      const result = await pool.query(
        "SELECT id, username, name, active, created_at FROM api_users WHERE id = $1 AND active = true",
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ message: "Usuário não encontrado" });
      }

      res.json(result.rows[0]);
    } catch (error: any) {
      if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
        return res.status(401).json({ message: "Token inválido ou expirado" });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/register", (req, res, next) => {
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (!apiKey) {
      return res.status(403).json({ message: "Registro requer API Key de administrador" });
    }
    const validKeys = (process.env.API_KEYS || "REDACTED_CREDENTIAL_CONFIGURE_ENV").split(",").map(k => k.trim()).filter(Boolean);
    if (!validKeys.includes(apiKey)) {
      return res.status(403).json({ message: "API Key inválida" });
    }
    next();
  }, async (req, res) => {
    try {
      const { username, password, name } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Usuário e senha são obrigatórios" });
      }

      if (password.length < 6) {
        return res.status(400).json({ message: "Senha deve ter no mínimo 6 caracteres" });
      }

      const existing = await pool.query(
        "SELECT id FROM api_users WHERE username = $1",
        [username]
      );

      if (existing.rows.length > 0) {
        return res.status(409).json({ message: "Usuário já existe" });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const result = await pool.query(
        "INSERT INTO api_users (username, password_hash, name) VALUES ($1, $2, $3) RETURNING id, username, name, active, created_at",
        [username, passwordHash, name || null]
      );

      res.json({ message: "Usuário criado com sucesso", user: result.rows[0] });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
