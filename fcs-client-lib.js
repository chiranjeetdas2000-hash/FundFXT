(function (global) {
    const isNode = typeof window === 'undefined'; // Check if running in Node.js or browser
    const WebSocketImpl = isNode ? require('ws') : WebSocket;

    class FCSClient {
        constructor(apiKey,url=null) {
            this.url = url ? url : 'wss://ws-v4.fcsapi.com/ws';
            this.apiKey = apiKey;
            this.socket = null;
            this.activeSubscriptions = new Map();
            this.heartbeat = null;
            this.reconnectDelay = 3000;
            this.manualClose = false;
            this.isConnected = false;
            this.showLogs = false;

            // Event callbacks
            this.onconnected = null;
            this.onclose = null;
            this.onmessage = null;
            this.onerror = null;
            this.onreconnect = null;
            this.countreconnects = 0;
            this.reconnectlimit = 5;
            this.isreconnect = false;

            // Tab visibility / connection mode settings
            this.focusTimeout = 20; // minutes, set 0 to never disconnect
            this._timeoutConverted = false; // Prevent re-conversion on reconnect

            this.visibilityTimeout = null;
            this.visibilityDisconnectTime = null; // Track when disconnect timer started
            this.intentionalDisconnect = false; // Flag to prevent auto-reconnect when tab hidden

            // ch/chp tracking: key = "SYMBOL_TF" -> { pc, lastT, lastC }
            this._pcStore = new Map();
            // Initialize visibility handling if in browser
            if (!isNode && this.focusTimeout > 0) {
                this.initVisibilityHandling();
            }
        }

        /**
         * Connect returns a Promise that resolves when connected
         */
        connect() {
            if (this.focusTimeout > 0 && !this._timeoutConverted) {
                this.focusTimeout = this.focusTimeout * 60 * 1000; // convert minutes to ms (once only)
                this._timeoutConverted = true;
            }

            if (!this.apiKey) return Promise.reject(new Error('API Key required'));

            return new Promise((resolve, reject) => {
                const wsUrl = `${this.url}?access_key=${this.apiKey}`;
                this.socket = new WebSocketImpl(wsUrl);

                this.socket.onopen = () => {
                    this.manualClose = false;
                    resolve(this); // resolve with client instance
                };

                this.socket.onmessage = (event) => {
                    let data;
                    try {
                        data = JSON.parse(isNode ? event.data.toString() : event.data);
                    } catch (e) {
                        if (this.showLogs) {
                            console.error('[FCS] Invalid message from server, Please report this to support@fcsapi.com', e);
                        }
                        return;
                    }
                    if (data.type === 'ping') {
                        this.send({ type: 'pong', timestamp: Date.now() });
                        return;
                    } else if (data.type === 'welcome') {
                        // Successfully connected, pass all security checks
                        this.isConnected = true;
                        this.countreconnects = 0;
                        this.intentionalDisconnect = false; // Reset flag on successful connection
                        this.visibilityDisconnectTime = null; // Clear disconnect timer
                        this.rejoinAll();
                        this.startHeartbeat();
                        if (this.isreconnect && typeof this.onreconnect === 'function') this.onreconnect();
                        if (!this.isreconnect && typeof this.onconnected === 'function') this.onconnected();
                        return;
                    }
                    else if (data.type === 'message') {
                        if (data.short && data.short === 'joined_room') {
                            if (this.showLogs) {
                                console.log(`[FCS] Subscribed to ${data.symbol} ${data.timeframe}`);
                            }
                            if (data.symbol && data.timeframe) {
                                const key = `${data.symbol.toUpperCase()}_${data.timeframe}`;
                                this.activeSubscriptions.set(key, { symbol: data.symbol, timeframe: data.timeframe });
                            }
                        }
                    }
                    // Enrich price data with ch/chp
                    if (data.type === 'price' && data.prices) {
                        this._enrichChChp(data);
                    }
                    // Pass data to onmessage callback
                    if (typeof this.onmessage === 'function') this.onmessage(data);
                };

                this.socket.onerror = (err) => {
                    if (typeof this.onerror === 'function') this.onerror(err);
                };

                this.socket.onclose = (event) => {
                    if (this.showLogs) {
                        console.warn(`[FCS] Disconnected. Code: ${event.code}, Reason: ${event.reason || 'none'}`);
                    }
                    this.stopHeartbeat();
                    this.isConnected = false;
                    this.socket = null;
                    if (typeof this.onclose === 'function') this.onclose(event);

                    // Smart reconnect logic
                    if (!this.manualClose) {
                        // Check if this was an intentional disconnect due to tab visibility
                        if (this.intentionalDisconnect) {
                            if (this.showLogs) {
                                console.log('[FCS] Tab hidden disconnect - auto-reconnect disabled');
                            }
                            return;
                        }

                        // Check if we're within the visibility disconnect time limit
                        if (this.visibilityDisconnectTime) {
                            const delay = this.focusTimeout;
                            const elapsed = Date.now() - this.visibilityDisconnectTime;

                            if (elapsed >= delay) {
                                // Time limit exceeded, don't auto-reconnect
                                if (this.showLogs) { console.log('[FCS] Disconnect time limit exceeded - auto-reconnect disabled'); }
                                this.visibilityDisconnectTime = null;
                                return;
                            }
                        }

                        // Normal auto-reconnect for network issues
                        this.countreconnects++;
                        if (this.showLogs) {
                            console.log(`[FCS] Attempting to reconnect in ${this.reconnectDelay / 1000}s... (Attempt ${this.countreconnects}/${this.reconnectlimit})`);
                        }
                        if (this.countreconnects > this.reconnectlimit) {
                            if (this.reconnectlimit > 0) {
                                if (this.showLogs) {
                                    console.error('[FCS] Maximum reconnect attempts reached. Please check your network or contact support@fcsapi.com');
                                }
                            }
                            return;
                        }
                        this.isreconnect = true;
                        setTimeout(() => this.connect(), this.reconnectDelay);
                    }
                };
            });
        }

        disconnect() {
            this.manualClose = true;
            this.isConnected = false;
            this.clearVisibilityTimeout(); // Clear any pending visibility timeout
            if (this.socket) {
                this.socket.close();
                this.socket = null;
                this.stopHeartbeat();
            }
        }

        // this is making it alove in browser and nodejs
        startHeartbeat() {
            if (!this.socket) return;
            this.stopHeartbeat();
            this.heartbeat = setInterval(() => {
                // for browser and nodejs
                if (this.socket && this.socket.readyState === WebSocketImpl.OPEN) {
                    if (isNode) this.socket.ping();
                }

                // for fcs server
                this.send({ type: 'ping', timestamp: Date.now() });
            }, 25000);
        }

        stopHeartbeat() {
            if (this.heartbeat) {
                clearInterval(this.heartbeat);
                this.heartbeat = null;
            }
        }

        send(data) {
            if (!this.socket || this.socket.readyState !== WebSocketImpl.OPEN) return false;
            try {
                this.socket.send(JSON.stringify(data));
                return true;
            } catch (e) {
                return false;
            }
        }

        join(symbol, timeframe) {
            if (!symbol || !timeframe) {
                if (this.showLogs) {
                    console.error('[FCS] Symbol and timeframe are required to join');
                }
                return;
            };
            if (!symbol.includes(':')) {
                if (this.showLogs) {
                    console.error('[FCS] Symbol must include exchange prefix, e.g., "BINANCE:BTCUSDT"');
                }
                return;
            };

            this.send({ type: 'join_symbol', symbol, timeframe });
        }

        leave(symbol, timeframe) {
            if (!symbol || !timeframe) return;
            const key = `${symbol.toUpperCase()}_${timeframe}`;
            this.activeSubscriptions.delete(key);
            this.send({ type: 'leave_symbol', symbol, timeframe });
        }

        removeAll() {
            this.activeSubscriptions.clear();
            this.send({ type: 'remove_all' });
        }

        rejoinAll() {
            this.activeSubscriptions.forEach(({ symbol, timeframe }) => {
                this.send({ type: 'join_symbol', symbol, timeframe });
            });
        }

        /**
         * Enrich price message with ch (change) and chp (change percent) based on previous close.
         * pc is stored per symbol+timeframe and updated when a new candle opens.
         */
        _decimals(n) {
            const d = n.toString().indexOf('.');
            return d === -1 ? 0 : n.toString().length - d - 1;
        }

        _enrichChChp(data) {
            const { symbol, timeframe, prices } = data;
            if (!symbol || !timeframe || !prices) return;

            const mode = prices.mode;
            if (mode !== 'profile' && mode !== 'initial' && mode !== 'candle' && mode !== 'close' && mode !== 'askbid') return;

            const key = `${symbol.toUpperCase()}_${timeframe}`;

            // Ensure entry always exists
            let entry = this._pcStore.get(key);
            if (!entry) {
                entry = { pc: null, lastT: null, lastC: null, o: null, h: null, l: null, current_session: null };
                this._pcStore.set(key, entry);
            }

            if (mode === 'profile') {
                const session = prices.profile && prices.profile.current_session;
                if (session !== undefined) { entry.current_session = session; prices.current_session = session; }
                return;

            } else if (mode === 'initial') {
                const history = prices.history || data.history;
                let pc = null;
                if (history && history.length > 0) { pc = history[history.length - 1].c; }
                else if (typeof prices.o === 'number') { pc = prices.o; }
                entry.pc = pc; entry.lastT = prices.t; entry.lastC = prices.c;
                entry.o = prices.o; entry.h = prices.h; entry.l = prices.l;

            } else if (mode === 'candle' || mode === 'close') {
                // candle: promote pc if new candle detected; close: pc promoted after ch/chp (bottom of method)
                if (prices.t !== entry.lastT && entry.lastC !== null) { entry.pc = entry.lastC; }
                entry.lastT = prices.t; entry.lastC = prices.c;
                entry.o = prices.o; entry.h = prices.h; entry.l = prices.l;

            } else if (mode === 'askbid') {
                if (entry.o !== null) prices.o = entry.o;
                if (entry.h !== null) prices.h = entry.h;
                if (entry.l !== null) prices.l = entry.l;
                if (typeof prices.c === 'number') {
                    if (prices.h !== null && prices.c > prices.h) { prices.h = prices.c; entry.h = prices.c; }
                    if (prices.l !== null && prices.c < prices.l) { prices.l = prices.c; entry.l = prices.c; }
                }
            }

            if (!entry || entry.pc === null) return;

            // Inject last known session status into every price message
            if (entry.current_session !== null) prices.current_session = entry.current_session;

            const pc = entry.pc;
            const c = prices.c;
            if (typeof c !== 'number' || typeof pc !== 'number' || pc === 0) return;

            const chPrec = Math.min(Math.max(Math.max(this._decimals(c), this._decimals(pc)) + 1, 2), 10);
            const ch = parseFloat((c - pc).toFixed(chPrec));
            const chp = parseFloat(((ch / pc) * 100).toFixed(4));
            prices.pc = pc;
            prices.ch = ch;
            prices.chp = chp;

            // After ch/chp computed: promote closed candle's c to pc for the next candle
            if (mode === 'close') entry.pc = prices.c;
        }

        /**
         * Initialize Page Visibility API handling for automatic disconnect/reconnect
         * Only works in browser environment
         */
        initVisibilityHandling() {
            if (typeof document === 'undefined') return;

            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    // Tab hidden - schedule disconnect based on mode
                    this.handleTabHidden();
                } else {
                    // Tab visible - cancel disconnect and reconnect if needed
                    this.handleTabVisible();
                }
            });
        }

        /**
         * Handle when browser tab becomes hidden
         */
        handleTabHidden() {
            this.clearVisibilityTimeout();
            // Set delay based on connection mode
            // auto: 3 seconds, persistent: 10 seconds (approximate)
            const delay = this.focusTimeout;
            if (this.showLogs) {
                console.log(`[FCS] Tab hidden. Will disconnect in ${delay / 1000}s if not returned (focusTimeout: ${this.focusTimeout})`);
            }
            // Mark when the disconnect timer started
            this.visibilityDisconnectTime = Date.now();

            this.visibilityTimeout = setTimeout(() => {
                if (this.isConnected) {
                    if (this.showLogs) {
                        console.log('[FCS] Tab inactive - disconnecting to save resources');
                    }
                    this.intentionalDisconnect = true; // Prevent auto-reconnect
                    this.manualClose = true; // Treat as manual close
                    this.disconnect();
                    this.manualClose = false; // Reset for future reconnects
                }
            }, delay);
        }

        /**
         * Handle when browser tab becomes visible
         */
        handleTabVisible() {
            this.clearVisibilityTimeout();
            if (this.manualClose) return; // Do nothing if manually closed

            // If tab became visible before time limit, allow reconnect
            if (this.visibilityDisconnectTime) {
                const delay = this.focusTimeout;
                const elapsed = Date.now() - this.visibilityDisconnectTime;

                if (elapsed < delay) {
                    // Within time limit - clear the timer
                    this.visibilityDisconnectTime = null;
                }
            }

            // Reconnect if we have active subscriptions but no connection
            if (!this.isConnected && this.activeSubscriptions.size > 0) {
                if (this.showLogs) { console.log('[FCS] Tab active - reconnecting...'); }
                this.intentionalDisconnect = false;
                this.visibilityDisconnectTime = null;
                this.connect();
            } else if (this.isConnected) {
                if (this.showLogs) { console.log('[FCS] Tab active - connection maintained'); }
            }
        }

        /**
         * Clear pending visibility timeout
         */
        clearVisibilityTimeout() {
            if (this.visibilityTimeout) {
                clearTimeout(this.visibilityTimeout);
                this.visibilityTimeout = null;
            }
        }
    }

    if (isNode) module.exports = FCSClient;
    else global.FCSClient = FCSClient;

})(typeof window !== 'undefined' ? window : global);