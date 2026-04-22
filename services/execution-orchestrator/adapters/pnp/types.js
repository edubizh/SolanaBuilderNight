/**
 * @typedef {Object} PnpMarket
 * @property {string} marketId
 * @property {'v2'|'v3'} version
 * @property {string} baseSymbol
 * @property {string} quoteSymbol
 */

/**
 * @typedef {Object} PnpQuote
 * @property {string} marketId
 * @property {number} price
 * @property {number} size
 * @property {number} fetchedAtMs
 */

/**
 * @typedef {Object} PnpOrderRequest
 * @property {string} intentId
 * @property {string} marketId
 * @property {'buy'|'sell'} side
 * @property {number} size
 * @property {'v2'|'v3'} [marketVersion]
 * @property {number} [maxSlippageBps]
 * @property {{requiresResolvableBy: boolean, marketCreatedAtMs: number}} [customOracleGuardrail]
 */

/**
 * @typedef {Object} PnpOrderResult
 * @property {string} intentId
 * @property {string} marketId
 * @property {'buy'|'sell'} [side]
 * @property {number} [size]
 * @property {string} orderId
 * @property {'accepted'|'rejected'} status
 * @property {number} [acceptedAtMs]
 */
