/**
 * In-memory rate limiting middleware.
 * Limits submissions to 1 request per 60 seconds per client IP address.
 * Records the timestamp upon a successful submission (status 201).
 */
const lastSubmissionTimestamps = new Map();

function rateLimiter(req, res, next) {
  // Extract client IP address, accounting for reverse proxies
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = forwarded ? forwarded.split(',')[0].trim() : (req.socket?.remoteAddress || req.ip || '127.0.0.1');
  const clientIp = typeof rawIp === 'string' ? rawIp : String(rawIp);

  const now = Date.now();
  const lastSubmission = lastSubmissionTimestamps.get(clientIp);

  if (lastSubmission && (now - lastSubmission) < 60000) {
    return res.status(429).json({
      error: "Too many requests. Please wait a minute before submitting again."
    });
  }

  // Intercept response completion to record timestamp only on successful creation (201)
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode === 201) {
      lastSubmissionTimestamps.set(clientIp, Date.now());
    }
    return originalJson(body);
  };

  next();
}

// Helper to reset rate limits (useful for automated testing)
rateLimiter.reset = () => {
  lastSubmissionTimestamps.clear();
};

rateLimiter.getTimestamp = (ip) => {
  return lastSubmissionTimestamps.get(ip);
};

rateLimiter.setTimestamp = (ip, timestamp) => {
  lastSubmissionTimestamps.set(ip, timestamp);
};

module.exports = rateLimiter;
