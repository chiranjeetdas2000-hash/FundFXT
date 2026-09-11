(() => {
  const API = "https://fundFXT.onrender.com";
  const token = localStorage.getItem("fundfxt_admin_token");
  if (!token) return;

  const esc = (v) => String(v ?? "").replace(/[&<>\"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

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

  function inject() {
    const table = document.getElementById("ordersBody");
    if (!table) return;
    const rows = table.querySelectorAll("tr");
    rows.forEach((row, index) => {
      if (row.dataset.identityRepairAdded === "1") return;
      const order = Array.isArray(window.orders) ? window.orders[index] : null;
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

  const observer = new MutationObserver(inject);
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(inject, 1200);
  inject();
})();
