(() => {
  let active = 0;
  const setBusy = (busy) => document.querySelectorAll('.refresh-action').forEach((button) => button.classList.toggle('refreshing', busy));
  const originalFetch = window.fetch.bind(window);

  const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

  const today = () => new Date().toISOString().slice(0, 10);
  const isToday = (value) => value && String(value).slice(0, 10) === today();

  async function bridgeDashboard(url, options) {
    const headers = options?.headers || {};
    const [payments, withdrawals] = await Promise.all([
      originalFetch(url.origin + '/api/admin/payment-orders', { headers }),
      originalFetch(url.origin + '/api/admin/withdrawals', { headers })
    ]);
    const paymentData = payments.ok ? await payments.json() : { orders: [] };
    const withdrawalData = withdrawals.ok ? await withdrawals.json() : { withdrawals: [] };
    const orders = paymentData.orders || paymentData.requests || [];
    const withdrawalRows = withdrawalData.withdrawals || [];
    const successful = orders.filter((x) => ['PAYMENT_DONE', 'PAYMENT_APPROVED', 'ACCOUNT_CREATED'].includes(String(x.status || '').toUpperCase()));
    return jsonResponse({
      success: true,
      stats: {
        payment_requests_today: orders.filter((x) => isToday(x.created_at)).length,
        withdrawal_requests_today: withdrawalRows.filter((x) => isToday(x.created_at)).length,
        passed_accounts_today: 0,
        failed_accounts_today: 0,
        successful_revenue_cents: successful.filter((x) => isToday(x.created_at)).reduce((sum, x) => sum + Number(x.final_amount_cents || 0), 0)
      }
    });
  }

  window.fetch = async (...args) => {
    active += 1;
    setBusy(true);
    try {
      let input = args[0];
      const options = args[1] || {};
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const path = url.pathname;

      // The live server already exposes this legacy admin route. Use it as the
      // compatibility bridge while the canonical payment_requests route is being consolidated.
      if (path === '/api/admin/payment-requests' && (!options.method || options.method.toUpperCase() === 'GET')) {
        const canonical = await originalFetch(url.href, options);
        if (canonical.status !== 404) return canonical;
        url.pathname = '/api/admin/payment-orders';
        return originalFetch(url.href, options);
      }

      // The overview endpoint was injected through a preload and can return 404
      // when that preload is not active. Build the same dashboard response from
      // admin endpoints that are registered directly in server.js.
      if (path === '/api/admin/dashboard-stats' && (!options.method || options.method.toUpperCase() === 'GET')) {
        return bridgeDashboard(url, options);
      }

      // Status updates can safely use the existing server.js payment-order route.
      const statusMatch = path.match(/^\/api\/admin\/payment-requests\/(\d+)\/status$/);
      if (statusMatch && options.method?.toUpperCase() === 'POST') {
        let body = {};
        try { body = JSON.parse(options.body || '{}'); } catch {}
        const normalized = body.status === 'PAYMENT_APPROVED' ? 'PAYMENT_DONE' : body.status === 'PAYMENT_CANCELLED' ? 'CANCELLED' : body.status;
        const nextOptions = { ...options, body: JSON.stringify({ status: normalized }) };
        return originalFetch(url.origin + '/api/admin/payment-orders/' + statusMatch[1] + '/status', nextOptions);
      }

      return originalFetch(...args);
    } finally {
      active = Math.max(0, active - 1);
      if (!active) setBusy(false);
    }
  };
})();
