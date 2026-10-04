const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

function rateLimitHandler(req, res) {
  const resetTime = req.rateLimit && req.rateLimit.resetTime instanceof Date
    ? req.rateLimit.resetTime.getTime()
    : Date.now() + 60 * 1000;

  const retryAfterSec = Math.max(
    1,
    Math.ceil((resetTime - Date.now()) / 1000),
  );

  res.setHeader("Retry-After", retryAfterSec);

  const logData = {
    endpoint: req.originalUrl,
    userId: req.userId || req.user?.id || null,
    ip: req.ip,
    retryAfter: retryAfterSec,
    timestamp: new Date().toISOString(),
  };

  console.warn("[RATE-LIMIT]", JSON.stringify(logData));

  return res.status(429).json({
    error: `Too many requests. Try again in ${retryAfterSec} seconds.`,
    retry_after: retryAfterSec,
  });
}

function createRateLimiter(options = {}) {
  return rateLimit({
    standardHeaders: false,
    legacyHeaders: false,
    handler: rateLimitHandler,
    ...options,
  });
}

function createUserRateLimiter(options = {}) {
  return createRateLimiter({
    keyGenerator: (req) =>
      String(req.userId || req.user?.id || ipKeyGenerator(req.ip)),
    ...options,
  });
}

function userRateLimiter(limit, windowMs) {
  return createUserRateLimiter({
    limit,
    windowMs,
  });
}

module.exports = {
  createRateLimiter,
  createUserRateLimiter,
  userRateLimiter,
  rateLimitHandler,
};
