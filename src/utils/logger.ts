/**
 * Simple logger used by cron jobs and other background processes.
 *
 * The logger respects the environment variable `LOG_LEVEL`.
 *   - When LOG_LEVEL is set to "error", only error messages are printed.
 *   - For any other value (or when undefined), info messages are printed as well.
 *
 * This lightweight implementation avoids pulling in a full‑featured library
 * (like winston) while still giving us the ability to silence noisy output in
 * production.
 */

export const logger = {
  /**
   * Print an error message. Errors are always shown because they indicate a
   * failure that needs attention.
   */
  error: (...args: unknown[]) => {
    // Using console.error ensures the message goes to stderr.
    console.error(...args);
  },

  /**
   * Print an informational message. The message is shown unless LOG_LEVEL is
   * explicitly set to "error".
   */
  info: (...args: unknown[]) => {
    if (process.env.LOG_LEVEL && process.env.LOG_LEVEL.toLowerCase() === 'error') {
      // Suppress info logs in error‑only mode.
      return;
    }
    console.log(...args);
  },
};
