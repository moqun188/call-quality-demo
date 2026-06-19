/**
 * JWT 认证模块 (S5-014)
 * 用户注册/登录/鉴权，支持多租户隔离
 */

const crypto = require("crypto");
const { getDb } = require("./database");

// 简单 JWT 实现（生产环境建议用 jsonwebtoken 库）
const SECRET = process.env.JWT_SECRET || "callq-secret-key-change-in-production";

function base64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function sign(payload) {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const body = base64url(payload);
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expectedSig = crypto
    .createHmac("sha256", SECRET)
    .update(`${parts[0]}.${parts[1]}`)
    .digest("base64url");
  if (parts[2] !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  return { salt, hash };
}

/**
 * 注册用户
 */
function register({ username, password, tenantName, role }) {
  const db = getDb();
  try {
    // 检查用户表是否存在
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        tenant_name TEXT DEFAULT '',
        role TEXT DEFAULT 'inspector',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 检查用户是否已存在
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existing) return { error: "用户名已存在" };

    const { salt, hash } = hashPassword(password);
    const tenantId = tenantName
      ? tenantName.toLowerCase().replace(/[^a-z0-9]/g, "-")
      : "default";

    const result = db.prepare(`
      INSERT INTO users (username, password_hash, password_salt, tenant_id, tenant_name, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(username, hash, salt, tenantId, tenantName || "", role || "inspector");

    const token = sign({
      userId: result.lastInsertRowid,
      username,
      tenantId,
      role: role || "inspector",
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600, // 7 天
    });

    return {
      token,
      user: {
        id: result.lastInsertRowid,
        username,
        tenantId,
        tenantName: tenantName || "",
        role: role || "inspector",
      },
    };
  } finally {
    db.close();
  }
}

/**
 * 登录
 */
function login({ username, password }) {
  const db = getDb();
  try {
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!user) return { error: "用户名或密码错误" };

    const { hash } = hashPassword(password, user.password_salt);
    if (hash !== user.password_hash) return { error: "用户名或密码错误" };

    const token = sign({
      userId: user.id,
      username: user.username,
      tenantId: user.tenant_id,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        tenantId: user.tenant_id,
        tenantName: user.tenant_name,
        role: user.role,
      },
    };
  } finally {
    db.close();
  }
}

/**
 * Express 中间件：验证 JWT
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "未登录，请先登录" });
  }

  const payload = verify(authHeader.slice(7));
  if (!payload) {
    return res.status(401).json({ error: "登录已过期，请重新登录" });
  }

  req.user = payload;
  next();
}

/**
 * 可选鉴权中间件（有 token 解析，没有也放行）
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const payload = verify(authHeader.slice(7));
    if (payload) req.user = payload;
  }
  next();
}

module.exports = { register, login, authMiddleware, optionalAuth, sign, verify };
