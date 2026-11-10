import express from "express";
import { UserService } from "../services/userService.js";
import { authenticateToken, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Enforce both JWT authentication and Admin role across all /api/admin routes
router.use(authenticateToken);
router.use(requireAdmin);

// ============================================================================
// 1. GET ALL USERS (Admin Only)
// ============================================================================
router.get("/users", (req, res) => {
  try {
    const users = UserService.getAllUsers();
    res.json({
      success: true,
      total: users.length,
      users
    });
  } catch (err) {
    console.error("Admin get users error:", err);
    res.status(500).json({ error: "Failed to retrieve users." });
  }
});

// ============================================================================
// 2. UPDATE USER ROLE (Admin Only)
// ============================================================================
router.patch("/users/:id/role", (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role || !["admin", "user"].includes(role)) {
      return res.status(400).json({ error: "Role must be either 'admin' or 'user'." });
    }

    // Prevent demoting self from admin to prevent lockout
    if (req.user.id === id && role !== "admin") {
      return res.status(400).json({ error: "You cannot remove your own admin privileges." });
    }

    const updated = UserService.updateRole(id, role);
    res.json({
      success: true,
      message: `User role updated to '${role}' successfully.`,
      user: updated
    });
  } catch (err) {
    console.error("Admin update role error:", err);
    res.status(500).json({ error: err.message || "Failed to update user role." });
  }
});

// ============================================================================
// 3. DELETE USER (Admin Only)
// ============================================================================
router.delete("/users/:id", (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting self
    if (req.user.id === id) {
      return res.status(400).json({ error: "You cannot delete your own admin account." });
    }

    const deleted = UserService.deleteUser(id);
    res.json({
      success: true,
      message: `User '${deleted.email}' has been removed successfully.`
    });
  } catch (err) {
    console.error("Admin delete user error:", err);
    res.status(500).json({ error: err.message || "Failed to delete user." });
  }
});

// ============================================================================
// 4. GET SYSTEM STATS (Admin Only)
// ============================================================================
router.get("/stats", (req, res) => {
  try {
    const users = UserService.getAllUsers();
    const admins = users.filter(u => u.role === "admin").length;
    const regularUsers = users.filter(u => u.role === "user").length;

    res.json({
      success: true,
      stats: {
        totalUsers: users.length,
        totalAdmins: admins,
        totalRegularUsers: regularUsers,
        serverUptime: Math.floor(process.uptime()),
        nodeVersion: process.version,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ error: "Failed to retrieve statistics." });
  }
});

export default router;

