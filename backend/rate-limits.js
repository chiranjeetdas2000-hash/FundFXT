const { rateLimit } = require("express-rate-limit");

function rateLimitHandler(req, res) {
  const resetTime = req.rateLimit && req.rateLimit.resetTime instanceof Date
    ? req.rateLimit.resetTime.getTime()
    : Date.now() + 60 * 1000;

  const retryAfter = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));

  return res.status(429).json({
    error: "Too many requests. Try again later.",
    retry_after: retryAfter
  });
}

function createRateLimiter(options = {}) {
  return rateLimit({
    standardHeaders: false,
    legacyHeaders: false,
    handler: rateLimitHandler,
    ...options
  });
}

function createUserRateLimiter(options = {}) {
  return createRateLimiter({
    keyGenerator: (req) => String(req.userId || req.user?.id || req.ip),
    ...options
  });
}

module.exports = {
  createRateLimiter,
  createUserRateLimiter,
  rateLimitHandler
};
