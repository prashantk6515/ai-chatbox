import express from "express";
import jwt from "jsonwebtoken";
import { UserService } from "../services/userService.js";
import {
  generateTokens,
  authenticateToken,
  authRateLimiter
} from "../middleware/authMiddleware.js";

const router = express.Router();
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "agentic-ai-studio-refresh-secret-key-2026-secure";

// Email regex validation
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// ============================================================================
// 1. SIGNUP / REGISTRATION
// ============================================================================
router.post("/register", authRateLimiter, async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    // Field presence validation
    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ error: "Full Name must be at least 2 characters long." });
    }

    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ error: "Please enter a valid email address (e.g. user@example.com)." });
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }

    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match. Please re-enter." });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Duplicate email check
    const existing = UserService.findByEmail(cleanEmail);
    if (existing) {
      return res.status(409).json({
        error: "An account with this email address already exists. Please sign in instead."
      });
    }

    // Create user with BCrypt hash
    const newUser = await UserService.createUser({
      name: name.trim(),
      email: cleanEmail,
      password: password,
      role: cleanEmail.includes("admin") ? "admin" : "user",
      isVerified: true
    });

    // Generate JWT access & refresh tokens
    const tokens = generateTokens(newUser, false);

    res.status(201).json({
      success: true,
      message: "Account created successfully!",
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        isVerified: newUser.isVerified
      },
      tokens
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: err.message || "Failed to create account. Please try again." });
  }
});

// ============================================================================
// 2. LOGIN
// ============================================================================
router.post("/login", authRateLimiter, async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Please provide both email address and password." });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = UserService.findByEmail(cleanEmail);

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Verify BCrypt password hash
    const isPasswordValid = await UserService.verifyPassword(user, password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Generate JWT tokens
    const tokens = generateTokens(user, Boolean(rememberMe));

    res.json({
      success: true,
      message: `Welcome back, ${user.name}!`,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || "user",
        isVerified: user.isVerified
      },
      tokens
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

// ============================================================================
// 3. GET CURRENT USER PROFILE (/me)
// ============================================================================
router.get("/me", authenticateToken, (req, res) => {
  const user = UserService.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role || "user",
      isVerified: user.isVerified,
      createdAt: user.createdAt
    }
  });
});

// ============================================================================
// 4. LOGOUT
// ============================================================================
router.post("/logout", (req, res) => {
  res.json({ success: true, message: "Logged out successfully." });
});

// ============================================================================
// 5. REFRESH TOKEN
// ============================================================================
router.post("/refresh-token", (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: "Refresh token is required." });
  }

  jwt.verify(refreshToken, JWT_REFRESH_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired refresh token. Please log in again." });
    }

    const user = UserService.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const tokens = generateTokens(user, false);
    res.json({
      success: true,
      tokens
    });
  });
});

// ============================================================================
// 6. FORGOT PASSWORD
// ============================================================================
router.post("/forgot-password", authRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Please enter your email address." });
    }

    const cleanEmail = email.trim().toLowerCase();
    const resetInfo = UserService.generateResetToken(cleanEmail);

    // If user doesn't exist, respond with generic message for privacy
    if (!resetInfo) {
      return res.json({
        success: true,
        message: "If an account with that email exists, password reset instructions have been generated."
      });
    }

    // Direct reset code (first 6 characters of token in uppercase for easy input)
    const resetCode = resetInfo.token.slice(0, 6).toUpperCase();

    res.json({
      success: true,
      message: `Password reset instructions prepared for ${cleanEmail}.`,
      resetToken: resetInfo.token,
      resetCode: resetCode
    });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: "Failed to process forgot password request." });
  }
});

// ============================================================================
// 7. RESET PASSWORD
// ============================================================================
router.post("/reset-password", authRateLimiter, async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Reset token or code is required." });
    }

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters long." });
    }

    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match." });
    }

    // Check full token or 6-character code match
    const users = UserService.getAllUsers();
    let targetUser = UserService.findByResetToken(token);

    if (!targetUser) {
      // Check 6-character code match
      const allUsers = UserService.getAllUsers();
      for (const u of allUsers) {
        const fullUser = UserService.findById(u.id);
        if (
          fullUser?.resetPasswordToken &&
          fullUser.resetPasswordToken.slice(0, 6).toUpperCase() === token.trim().toUpperCase() &&
          new Date(fullUser.resetPasswordExpires) > new Date()
        ) {
          targetUser = fullUser;
          break;
        }
      }
    }

    if (!targetUser) {
      return res.status(400).json({
        error: "Password reset token is invalid or has expired. Please request a new one."
      });
    }

    await UserService.updatePassword(targetUser.id, newPassword);

    res.json({
      success: true,
      message: "Password has been reset successfully! You can now log in with your new password."
    });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Failed to reset password." });
  }
});

// ============================================================================
// 8. CHANGE PASSWORD (Logged-in User)
// ============================================================================
router.post("/change-password", authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters long." });
    }

    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      return res.status(400).json({ error: "New passwords do not match." });
    }

    const user = UserService.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const isCurrentValid = await UserService.verifyPassword(user, currentPassword);
    if (!isCurrentValid) {
      return res.status(400).json({ error: "Incorrect current password." });
    }

    await UserService.updatePassword(user.id, newPassword);

    res.json({
      success: true,
      message: "Password changed successfully!"
    });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ error: "Failed to change password." });
  }
});

export default router;

