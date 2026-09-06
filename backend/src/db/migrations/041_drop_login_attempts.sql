-- login_attempts was created in 001 and never read or written by any code path: login throttling
-- is done by the nginx auth zone and the Redis-backed rateLimiter middleware. (audit G9)
DROP TABLE IF EXISTS login_attempts;
