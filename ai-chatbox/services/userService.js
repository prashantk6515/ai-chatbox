import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure users file exists
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2), "utf8");
}

function readUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error reading users file:", err);
    return [];
  }
}

function writeUsers(users) {
  try {
    const tempFile = `${USERS_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(users, null, 2), "utf8");
    fs.renameSync(tempFile, USERS_FILE);
    return true;
  } catch (err) {
    console.error("Error writing users file:", err);
    return false;
  }
}

// Seed default accounts if empty
(function seedDefaultUsers() {
  const users = readUsers();
  let modified = false;

  const defaultAdmin = users.find(u => u.email === "admin@aistudio.com");
  if (!defaultAdmin) {
    const salt = bcrypt.genSaltSync(10);
    users.push({
      id: "usr_admin_default",
      name: "Studio Administrator",
      email: "admin@aistudio.com",
      passwordHash: bcrypt.hashSync("Admin@12345", salt),
      role: "admin",
      isVerified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    modified = true;
  }

  const defaultUser = users.find(u => u.email === "demo@aistudio.com");
  if (!defaultUser) {
    const salt = bcrypt.genSaltSync(10);
    users.push({
      id: "usr_demo_default",
      name: "Demo User",
      email: "demo@aistudio.com",
      passwordHash: bcrypt.hashSync("Demo@12345", salt),
      role: "user",
      isVerified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    modified = true;
  }

  if (modified) {
    writeUsers(users);
  }
})();

export const UserService = {
  // Find user by email (case-insensitive)
  findByEmail(email) {
    if (!email) return null;
    const clean = email.trim().toLowerCase();
    const users = readUsers();
    return users.find(u => u.email.toLowerCase() === clean) || null;
  },

  // Find user by ID
  findById(id) {
    if (!id) return null;
    const users = readUsers();
    return users.find(u => u.id === id) || null;
  },

  // Find user by reset token
  findByResetToken(token) {
    if (!token) return null;
    const users = readUsers();
    return users.find(u => 
      u.resetPasswordToken === token && 
      u.resetPasswordExpires && 
      new Date(u.resetPasswordExpires) > new Date()
    ) || null;
  },

  // Get all users (sanitized, no password hashes)
  getAllUsers() {
    const users = readUsers();
    return users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isVerified: u.isVerified,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt
    }));
  },

  // Create new user with bcrypt password hash
  async createUser({ name, email, password, role = "user", isVerified = false }) {
    const cleanEmail = email.trim().toLowerCase();
    const users = readUsers();

    if (users.some(u => u.email.toLowerCase() === cleanEmail)) {
      throw new Error("An account with this email address already exists.");
    }

    // Role assignment: First registered user or specified admins get admin role
    const finalRole = users.length === 0 ? "admin" : role;

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = {
      id: `usr_${crypto.randomBytes(8).toString("hex")}`,
      name: name.trim(),
      email: cleanEmail,
      passwordHash,
      role: finalRole,
      isVerified: Boolean(isVerified),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    users.push(newUser);
    writeUsers(users);

    return {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      isVerified: newUser.isVerified,
      createdAt: newUser.createdAt
    };
  },

  // Verify user password
  async verifyPassword(user, plainPassword) {
    if (!user || !user.passwordHash || !plainPassword) return false;
    return bcrypt.compare(plainPassword, user.passwordHash);
  },

  // Update password
  async updatePassword(userId, newPassword) {
    const users = readUsers();
    const user = users.find(u => u.id === userId);
    if (!user) throw new Error("User not found.");

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    user.updatedAt = new Date().toISOString();

    writeUsers(users);
    return true;
  },

  // Update user role (Admin operation)
  updateRole(userId, newRole) {
    if (!["admin", "user"].includes(newRole)) {
      throw new Error("Invalid role specified. Must be 'admin' or 'user'.");
    }
    const users = readUsers();
    const user = users.find(u => u.id === userId);
    if (!user) throw new Error("User not found.");

    user.role = newRole;
    user.updatedAt = new Date().toISOString();
    writeUsers(users);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };
  },

  // Delete user (Admin operation)
  deleteUser(userId) {
    const users = readUsers();
    const index = users.findIndex(u => u.id === userId);
    if (index === -1) throw new Error("User not found.");

    const deleted = users.splice(index, 1)[0];
    writeUsers(users);
    return { id: deleted.id, email: deleted.email };
  },

  // Generate password reset token (valid for 15 minutes)
  generateResetToken(email) {
    const cleanEmail = email.trim().toLowerCase();
    const users = readUsers();
    const user = users.find(u => u.email.toLowerCase() === cleanEmail);
    if (!user) return null;

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins

    user.resetPasswordToken = token;
    user.resetPasswordExpires = expires;
    user.updatedAt = new Date().toISOString();

    writeUsers(users);
    return { token, email: user.email, name: user.name };
  },

  // Mark user email verified
  verifyUserEmail(email) {
    const cleanEmail = email.trim().toLowerCase();
    const users = readUsers();
    const user = users.find(u => u.email.toLowerCase() === cleanEmail);
    if (!user) return false;

    user.isVerified = true;
    user.updatedAt = new Date().toISOString();
    writeUsers(users);
    return true;
  }
};

