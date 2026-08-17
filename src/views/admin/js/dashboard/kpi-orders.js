// Batch Load KPI Cards & Recent Orders
fetch('/admin/dashboard-stats', { headers: H })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (!res.success || !res.data) return;
    var d = res.data;

    // Populate KPI Cards
    if ($('kpi-totalProducts')) $('kpi-totalProducts').textContent = fmt(d.totalProducts);
    if ($('kpi-revenueToday')) $('kpi-revenueToday').textContent = fmtCurrency(d.revenueToday);
    if ($('kpi-newOrdersToday')) $('kpi-newOrdersToday').textContent = fmt(d.newOrdersToday);
    if ($('kpi-visitsToday')) $('kpi-visitsToday').textContent = fmt(d.visitsToday);
    if ($('kpi-lowStockCount')) $('kpi-lowStockCount').textContent = fmt(d.lowStockCount);
    if ($('kpi-totalUsers')) $('kpi-totalUsers').textContent = fmt(d.totalUsers);

    // Populate Recent Orders Table
    var tbody = $('tbl-recentOrders');
    if (tbody) {
      tbody.innerHTML = '';
      var orders = d.recentOrders || [];
      if (orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-gray-400 text-sm">Chưa có đơn hàng</td></tr>';
      } else {
        orders.forEach(function(o) {
          var tr = document.createElement('tr');
          if (o._id) {
            tr.className = 'bg-white border-b hover:bg-gray-50 cursor-pointer transition-colors';
            tr.addEventListener('click', function() {
              window.location.href = '/admin/orders/' + o._id;
            });
          } else {
            tr.className = 'bg-white border-b hover:bg-gray-50';
          }
          var dt = o.createdAt ? new Date(o.createdAt).toLocaleDateString('vi-VN') : '—';
          var rawName = (o.shippingInfo && o.shippingInfo.customerName) || o.customerName || (o.userId && (o.userId.fullName || o.userId.username || o.userId.email)) || 'Khách hàng';
          var name = escapeHtml(rawName);
          var sLabel = statusLabel[o.status] || o.status || '—';
          var sColor = statusColor[o.status] || 'text-gray-600 bg-gray-50';
          tr.innerHTML = '<th scope="row" class="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">'+name+'</th>'+
            '<td class="px-6 py-4 font-semibold">'+fmtCurrency(o.totalAmount)+'</td>'+
            '<td class="px-6 py-4"><span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold '+sColor+'">'+sLabel+'</span></td>'+
            '<td class="px-6 py-4 text-gray-500 text-sm">'+dt+'</td>';
          tbody.appendChild(tr);
        });
      }
    }
  })
  .catch(function(err) { console.error('Error fetching dashboard summary stats:', err); });
