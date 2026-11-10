import jwt from "jsonwebtoken";
import { UserService } from "../services/userService.js";

const JWT_SECRET = process.env.JWT_SECRET || "agentic-ai-studio-jwt-secret-key-2026-secure";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "agentic-ai-studio-refresh-secret-key-2026-secure";

// Generate Access & Refresh Tokens
export function generateTokens(user, rememberMe = false) {
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role || "user"
  };

  const accessTokenExpires = rememberMe ? "24h" : "1h";
  const refreshTokenExpires = rememberMe ? "30d" : "7d";

  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: accessTokenExpires });
  const refreshToken = jwt.sign({ id: user.id }, JWT_REFRESH_SECRET, { expiresIn: refreshTokenExpires });

  return { accessToken, refreshToken, expiresIn: accessTokenExpires };
}

// Extract token from request (Bearer header, query, or custom header)
export function extractToken(req) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }
  if (req.headers["x-access-token"]) {
    return req.headers["x-access-token"];
  }
  if (req.query && req.query.token) {
    return req.query.token;
  }
  return null;
}

// Authentication Middleware: Verifies JWT Token
export function authenticateToken(req, res, next) {
  const token = extractToken(req);

  // If no token provided, check if userEmail header was sent (backward compatibility)
  const legacyEmail = req.headers["x-user-email"] || req.body?.userEmail;

  if (!token) {
    if (legacyEmail) {
      const user = UserService.findByEmail(legacyEmail);
      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role || "user"
        };
        return next();
      }
    }
    return res.status(401).json({
      error: "Authentication required. Please log in to access this resource."
    });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          error: "Session expired. Please log in again.",
          expired: true
        });
      }
      return res.status(403).json({
        error: "Invalid authentication token. Please log in again."
      });
    }

    // Attach fresh user info from store
    const user = UserService.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: "User account no longer exists." });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role || "user"
    };

    next();
  });
}

// Optional Authentication Middleware: If token exists, sets req.user; otherwise proceeds
export function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (!err && decoded) {
      const user = UserService.findById(decoded.id);
      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role || "user"
        };
      }
    }
    next();
  });
}

// Authorization Middleware: Role-Based Access Control (RBAC)
export function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access Denied: Requires one of [${allowedRoles.join(", ")}] roles. Your current role is '${req.user.role}'.`
      });
    }

    next();
  };
}

// Shortcut: Require Admin
export const requireAdmin = requireRole(["admin"]);

// Rate Limiter Middleware to Prevent Brute-Force Attacks
const rateLimitMap = new Map();

export function createRateLimiter(maxAttempts = 10, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
    const now = Date.now();
    const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + windowMs };

    if (now > entry.resetAt) {
      entry.count = 1;
      entry.resetAt = now + windowMs;
    } else {
      entry.count += 1;
    }

    rateLimitMap.set(ip, entry);

    if (entry.count > maxAttempts) {
      const waitSec = Math.ceil((entry.resetAt - now) / 1000);
      return res.status(429).json({
        error: `Too many attempts from your IP. Please try again in ${waitSec} seconds.`
      });
    }

    next();
  };
}

export const authRateLimiter = createRateLimiter(15, 60000); // 15 attempts / minute

