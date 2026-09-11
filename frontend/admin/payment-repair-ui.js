(() => {
  const API = "https://fundfxt.onrender.com";
  const token = localStorage.getItem("fundFXT_admin_token");
  if (!token) return;

  async function getRequests() {
    const response = await fetch(`${API}/api/admin/payment-requests`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("Unable to load payment requests.");
    const data = await response.json();
    return data.requests || data.orders || [];
  }

  async function repairCustomer(id, requestId) {
    const email = prompt(`Repair customer for ${requestId}\n\nEnter the customer's registered FundFXT email:`);
    if (!email || !email.trim()) return;
    const response = await fetch(`${API}/api/admin/payment-requests/${encodeURIComponent(id)}/repair-customer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() })
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || `Repair failed (${response.status})`);
    alert(`Customer repaired successfully.\n\nRequest: ${data.request_id}\nCustomer: ${data.customer_name}\nEmail: ${data.customer_email}\nUser ID: ${data.user_id}`);
    if (typeof window.fetchOrders === "function") window.fetchOrders();
  }

  async function inject() {
    const table = document.getElementById("ordersBody");
    if (!table) return;
    const rows = table.querySelectorAll("tr");
    if (!rows.length) return;

    let orders;
    try { orders = await getRequests(); } catch { return; }
    const byRequestId = new Map(orders.map((o) => [String(o.request_id || o.request_ref || o.id), o]));

    rows.forEach((row) => {
      if (row.dataset.identityRepairAdded === "1") return;
      const requestId = row.querySelector("td:first-child")?.textContent?.trim();
      const order = byRequestId.get(requestId);
      if (!order?.id) return;
      const actionCell = row.lastElementChild;
      if (!actionCell) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn secondary";
      button.style.marginTop = "6px";
      button.textContent = "Repair Customer";
      button.onclick = () => repairCustomer(order.id, order.request_id || order.id).catch((e) => alert(e.message));
      actionCell.appendChild(button);
      row.dataset.identityRepairAdded = "1";
    });
  }

  const observer = new MutationObserver(() => inject());
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(inject, 2500);
  inject();
})();
