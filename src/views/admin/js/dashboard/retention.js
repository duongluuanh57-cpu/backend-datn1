// Load Brand Retention Chart
fetch('/api/funnel/brand-retention', { headers: H })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    var retData = (res.success && res.data) ? res.data : [];
    if (retData.length && $('chartRetention')) {
      new Chart($('chartRetention').getContext('2d'), {
        type: 'bar',
        data: {
          labels: retData.map(function(d){ return d.brandName; }),
          datasets: [
            { label: 'Khách mới', data: retData.map(function(d){ return d.new; }), backgroundColor: '#3b82f6', borderRadius: 3 },
            { label: 'Khách quay lại', data: retData.map(function(d){ return d.returning; }), backgroundColor: '#C9A96E', borderRadius: 3 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: function(v){ return fmt(v); } } } },
          plugins: {
            legend: { labels: { usePointStyle: true, padding: 16, font: { size: 12 } } },
            tooltip: { callbacks: { label: function(ctx){ return ctx.dataset.label + ': ' + fmtCurrency(ctx.parsed.y); } } }
          }
        }
      });
    }
  })
  .catch(function(err) { console.error('Error fetching brand retention:', err); });
