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

  async function dbRows(url, options, table, search = '') {
    const rowsUrl = url.origin + '/api/admin/database/tables/' + encodeURIComponent(table) + '/rows?page=1&pageSize=200&search=' + encodeURIComponent(search);
    const response = await originalFetch(rowsUrl, options);
    if (!response.ok) return response;
    return response;
  }

  async function paymentRequests(url, options) {
    const search = url.searchParams.get('request_id') || url.searchParams.get('request_ref') || '';
    const status = url.searchParams.get('status') || '';
    const response = await dbRows(url, options, 'payment_requests', search);
    if (!response.ok) return response;
    const data = await response.json();
    let rows = data.rows || [];
    if (status) rows = rows.filter((row) => String(row.status || '').toUpperCase() === String(status).toUpperCase());

    // Enrich affiliate_id with the affiliate user's name when available.
    try {
      const usersResponse = await originalFetch(url.origin + '/api/admin/users', options);
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        const byId = new Map((usersData.users || []).map((u) => [String(u.id), u.legal_name]));
        rows = rows.map((row) => ({ ...row, affiliate_name: row.affiliate_id ? (byId.get(String(row.affiliate_id)) || '') : '' }));
      }
    } catch {}

    return jsonResponse({ success: true, requests: rows, orders: rows });
  }

  async function dashboard(url, options) {
    try {
      const [payments, withdrawals] = await Promise.all([
        dbRows(url, options, 'payment_requests'),
        originalFetch(url.origin + '/api/admin/withdrawals', options)
      ]);
      if (!payments.ok) return payments;
      const paymentData = await payments.json();
      const withdrawalData = withdrawals.ok ? await withdrawals.json() : { withdrawals: [] };
      const rows = paymentData.rows || [];
      const withdrawalRows = withdrawalData.withdrawals || [];
      const successful = rows.filter((x) => ['PAYMENT_DONE', 'PAYMENT_APPROVED', 'ACCOUNT_CREATED'].includes(String(x.status || '').toUpperCase()));
      return jsonResponse({
        success: true,
        stats: {
          payment_requests_today: rows.filter((x) => isToday(x.created_at)).length,
          withdrawal_requests_today: withdrawalRows.filter((x) => isToday(x.created_at)).length,
          passed_accounts_today: 0,
          failed_accounts_today: 0,
          successful_revenue_cents: successful.filter((x) => isToday(x.created_at)).reduce((sum, x) => sum + Number(x.final_amount_cents || 0), 0)
        }
      });
    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  }

  window.fetch = async (...args) => {
    active += 1;
    setBusy(true);
    try {
      const input = args[0];
      const options = args[1] || {};
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const path = url.pathname;
      const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

      // Canonical payment UI bridge: read the real MySQL payment_requests table directly.
      if (path === '/api/admin/payment-requests' && method === 'GET') return paymentRequests(url, options);

      // Overview bridge: avoid the preload-only dashboard endpoint and derive the same
      // live figures from database-control + the existing withdrawal endpoint.
      if (path === '/api/admin/dashboard-stats' && method === 'GET') return dashboard(url, options);

      // Keep the current status UI compatible with the server.js payment-order route.
      const statusMatch = path.match(/^\/api\/admin\/payment-requests\/(\d+)\/status$/);
      if (statusMatch && method === 'POST') {
        let body = {};
        try { body = JSON.parse(options.body || '{}'); } catch {}
        const normalized = body.status === 'PAYMENT_APPROVED' ? 'PAYMENT_DONE' : body.status === 'PAYMENT_CANCELLED' ? 'CANCELLED' : body.status;
        return originalFetch(url.origin + '/api/admin/payment-orders/' + statusMatch[1] + '/status', {
          ...options,
          body: JSON.stringify({ status: normalized })
        });
      }

      return originalFetch(...args);
    } finally {
      active = Math.max(0, active - 1);
      if (!active) setBusy(false);
    }
  };
})();
