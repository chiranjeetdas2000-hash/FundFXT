// FundFXT boot entrypoint.
// Normalize legacy backend identifiers before start.js builds the runtime server.
// This guarantees the deployed runtime cannot fall back to the old payment_link
// or payout_requests database names even if an older route remains in server.js.
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
const originalReadFileSync = fs.readFileSync;

fs.readFileSync = function(file, options) {
    const value = originalReadFileSync.call(fs, file, options);
    if (path.resolve(String(file)) !== path.resolve(serverPath)) return value;

    const encoding = typeof options === 'string' ? options : options?.encoding;
    if (encoding === 'utf8' || encoding === 'utf-8') {
        return value
            .replace(/\bpayment_link\b/g, 'razorpay_link')
            .replace(/\bpayout_requests\b/g, 'withdrawal_request')
            // MySQL can run with ANSI_QUOTES enabled, where "LINK_SENT"
            // is parsed as a column identifier instead of a string literal.
            // Normalize this legacy route before the runtime server is built.
            .replace(/([=,]\s*)"LINK_SENT"/g, "$1'LINK_SENT'");
    }
    return value;
};

require('./start.js');
