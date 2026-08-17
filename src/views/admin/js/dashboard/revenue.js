// Revenue Chart & Calendar (Matching Trend & Heatmap Calendar Popup Style)
var chartRevenueInstance = null;

function loadRevenueChart(startDate, endDate) {
  var url = '/api/admin/daily-summary?days=7';
  if (startDate && endDate) {
    url = '/api/admin/daily-summary?startDate=' + startDate + '&endDate=' + endDate;
  }
  
  fetch(url, { headers: H, credentials: 'same-origin' })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (!res.success) {
        showToast(res.message || 'Lỗi tải dữ liệu doanh thu', 'error');
        return;
      }
      if (!res.data || !res.data.length) {
        showToast('Không có dữ liệu trong khoảng thời gian này', 'info');
        return;
      }
      var labels = [], revenue = [], orders = [];
      res.data.forEach(function(d){
        var dt = new Date(d.date);
        labels.push(dt.toLocaleDateString('vi-VN', { weekday:'short', day:'2-digit', month:'2-digit' }));
        revenue.push(Math.round(d.revenue));
        orders.push(d.orders);
      });
      
      if (chartRevenueInstance) {
        chartRevenueInstance.destroy();
        chartRevenueInstance = null;
      }
      
      if ($('chartRevenue7d')) {
        chartRevenueInstance = new Chart($('chartRevenue7d').getContext('2d'), {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              { label: 'Doanh thu (VND)', data: revenue, borderColor: '#C9A96E', backgroundColor: 'rgba(201,169,110,0.08)', fill: true, tension: 0.3, pointRadius: 3, yAxisID: 'y' },
              { label: 'Đơn hàng', data: orders, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.06)', fill: true, tension: 0.3, pointRadius: 3, yAxisID: 'y1' }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { usePointStyle: true, padding: 16 } } },
            scales: {
              x: { ticks: { maxTicksLimit: 7 } },
              y: { type: 'linear', position: 'left', title: { display: true, text: 'VND' }, ticks: { callback: function(v){ return fmt(v); } } },
              y1: { type: 'linear', position: 'right', title: { display: true, text: 'Đơn hàng' }, ticks: { stepSize: 1 }, grid: { drawOnChartArea: false } }
            }
          }
        });
      }
      if (typeof checkRevenueFiltersActive === 'function') checkRevenueFiltersActive();
    })
    .catch(function(err) { console.error('Daily summary fetch failed:', err); });
}

// Revenue Calendar States
var currentRevCalMonth = new Date().getMonth();
var currentRevCalYear = new Date().getFullYear();

var dRInit = new Date();
var dowRInit = dRInit.getDay();
var diffToMondayRInit = dRInit.getDate() - dowRInit + (dowRInit === 0 ? -6 : 1);
var revenueCalendarStart = new Date(dRInit.getFullYear(), dRInit.getMonth(), diffToMondayRInit);
revenueCalendarStart.setHours(0,0,0,0);

var revenueCalendarEnd = new Date(revenueCalendarStart);
revenueCalendarEnd.setDate(revenueCalendarStart.getDate() + 6);
revenueCalendarEnd.setHours(23,59,59,999);

var tempRevStart = new Date(revenueCalendarStart);
var tempRevEnd = new Date(revenueCalendarEnd);

function updateRevenueDateRangeDisplay() {
  if (revenueCalendarStart && revenueCalendarEnd) {
    $('lblRevenueDateRange').innerText = 'Tuần: ' + formatDisplayDate(revenueCalendarStart) + ' - ' + formatDisplayDate(revenueCalendarEnd);
  } else {
    $('lblRevenueDateRange').innerText = 'Chọn tuần';
  }
}

function highlightRevenueCalendarWeek(date) {
  var range = getWeekRange(date);
  var startStr = formatDate(range.monday);
  var endStr = formatDate(range.sunday);
  var todayStr = formatDate(new Date());
  
  var grid = $('gridRevCalendarDays');
  if (!grid) return;
  var btns = grid.querySelectorAll('button');
  btns.forEach(function(btn) {
    var bDateStr = btn.getAttribute('data-date');
    if (!bDateStr) return;
    
    if (bDateStr >= startStr && bDateStr <= endStr && bDateStr <= todayStr && !btn.disabled) {
      if (!btn.classList.contains('bg-gold-400')) {
        btn.classList.add('bg-gold-100/50');
        btn.classList.add('text-gold-700');
      }
    }
  });
}

function clearRevenueCalendarWeekHighlight() {
  var grid = $('gridRevCalendarDays');
  if (!grid) return;
  var btns = grid.querySelectorAll('button');
  btns.forEach(function(btn) {
    btn.classList.remove('bg-gold-100/50');
    btn.classList.remove('text-gold-700');
  });
}

function renderRevenueCalendarGrid() {
  var grid = $('gridRevCalendarDays');
  if (!grid) return;
  grid.innerHTML = '';
  
  var monthLabel = 'Tháng ' + String(currentRevCalMonth + 1).padStart(2, '0') + '/' + currentRevCalYear;
  $('lblRevMonthYear').innerText = monthLabel;
  
  var firstDayIndex = (new Date(currentRevCalYear, currentRevCalMonth, 1).getDay() + 6) % 7; // Monday = 0
  var totalDays = new Date(currentRevCalYear, currentRevCalMonth + 1, 0).getDate();
  var prevTotalDays = 30;
  try {
    prevTotalDays = new Date(currentRevCalYear, currentRevCalMonth, 0).getDate();
  } catch(_) {}

  for (var i = firstDayIndex - 1; i >= 0; i--) {
    var dayNum = prevTotalDays - i;
    var dDiv = document.createElement('div');
    dDiv.className = 'w-8 h-8 flex items-center justify-center mx-auto text-gray-300 cursor-not-allowed select-none';
    dDiv.innerText = dayNum;
    grid.appendChild(dDiv);
  }
  
  for (var day = 1; day <= totalDays; day++) {
    var dateObj = new Date(currentRevCalYear, currentRevCalMonth, day);
    dateObj.setHours(0,0,0,0);
    var dateStr = formatDate(dateObj);
    var todayStr = formatDate(new Date());
    
    var isFuture = dateStr > todayStr;
    
    var dDiv = document.createElement('button');
    dDiv.type = 'button';
    dDiv.innerText = day;
    dDiv.setAttribute('data-date', dateStr);
    
    var baseClass = 'w-8 h-8 flex items-center justify-center mx-auto text-xs font-medium transition-all outline-none ';
    
    if (isFuture) {
      dDiv.className = baseClass + 'text-gray-300 cursor-not-allowed pointer-events-none opacity-40 select-none';
      dDiv.disabled = true;
    } else {
      dDiv.className = baseClass + 'hover:bg-gray-100 rounded text-gray-700 cursor-pointer';
      
      dDiv.addEventListener('mouseenter', function() {
        var dStr = this.getAttribute('data-date');
        if (dStr && dStr <= todayStr) highlightRevenueCalendarWeek(new Date(dStr));
      });
      
      dDiv.addEventListener('mouseleave', function() {
        clearRevenueCalendarWeekHighlight();
        if (tempRevStart) highlightRevenueCalendarWeek(tempRevStart);
      });

      dDiv.addEventListener('click', function() {
        var clickedDateStr = this.getAttribute('data-date');
        if (!clickedDateStr || clickedDateStr > todayStr) return;
        var range = getWeekRange(new Date(clickedDateStr));
        tempRevStart = range.monday;
        tempRevEnd = range.sunday;
        
        clearRevenueCalendarWeekHighlight();
        highlightRevenueCalendarWeek(tempRevStart);
      });
    }
    grid.appendChild(dDiv);
  }
  
  if (tempRevStart) {
    highlightRevenueCalendarWeek(tempRevStart);
  }
}

if ($('btnOpenRevenueCalendar')) {
  $('btnOpenRevenueCalendar').addEventListener('click', function(e) {
    e.stopPropagation();
    var popup = $('revenueCalendarPopup');
    if (popup) {
      popup.classList.toggle('hidden');
      if (!popup.classList.contains('hidden')) {
        tempRevStart = new Date(revenueCalendarStart);
        tempRevEnd = new Date(revenueCalendarEnd);
        currentRevCalMonth = tempRevStart.getMonth();
        currentRevCalYear = tempRevStart.getFullYear();
        renderRevenueCalendarGrid();
      }
    }
  });
}

if ($('btnRevPrevMonth')) {
  $('btnRevPrevMonth').addEventListener('click', function(e) {
    e.stopPropagation();
    currentRevCalMonth--;
    if (currentRevCalMonth < 0) {
      currentRevCalMonth = 11;
      currentRevCalYear--;
    }
    renderRevenueCalendarGrid();
  });
}

if ($('btnRevNextMonth')) {
  $('btnRevNextMonth').addEventListener('click', function(e) {
    e.stopPropagation();
    currentRevCalMonth++;
    if (currentRevCalMonth > 11) {
      currentRevCalMonth = 0;
      currentRevCalYear++;
    }
    renderRevenueCalendarGrid();
  });
}

if ($('btnRevCancelCalendar')) {
  $('btnRevCancelCalendar').addEventListener('click', function(e) {
    e.stopPropagation();
    $('revenueCalendarPopup').classList.add('hidden');
  });
}

if ($('btnRevApplyCalendar')) {
  $('btnRevApplyCalendar').addEventListener('click', function(e) {
    e.stopPropagation();
    revenueCalendarStart = new Date(tempRevStart);
    revenueCalendarEnd = new Date(tempRevEnd);
    updateRevenueDateRangeDisplay();
    $('revenueCalendarPopup').classList.add('hidden');
    loadRevenueChart(formatDate(revenueCalendarStart), formatDate(revenueCalendarEnd));
  });
}

if ($('revenueDatePickerWrapper')) {
  document.addEventListener('click', function(e) {
    var container = $('revenueDatePickerWrapper');
    var popup = $('revenueCalendarPopup');
    if (container && popup && !container.contains(e.target) && !popup.classList.contains('hidden')) {
      popup.classList.add('hidden');
    }
  });
}

function checkRevenueFiltersActive() {
  var d = new Date();
  var dow = d.getDay();
  var diff = d.getDate() - dow + (dow === 0 ? -6 : 1);
  var currentWeekMon = new Date(d.getFullYear(), d.getMonth(), diff);
  currentWeekMon.setHours(0,0,0,0);
  
  var isDefaultWeek = (revenueCalendarStart && revenueCalendarStart.getTime() === currentWeekMon.getTime());
  var isActive = !isDefaultWeek;
  
  var btn = $('revenue-clear-filter');
  if (btn) {
    if (isActive) {
      btn.classList.add('show');
    } else {
      btn.classList.remove('show');
    }
  }
}

function resetRevenueFilters(e) {
  if (e) e.preventDefault();
  
  var d = new Date();
  var dow = d.getDay();
  var diff = d.getDate() - dow + (dow === 0 ? -6 : 1);
  revenueCalendarStart = new Date(d.getFullYear(), d.getMonth(), diff);
  revenueCalendarStart.setHours(0,0,0,0);
  
  revenueCalendarEnd = new Date(revenueCalendarStart);
  revenueCalendarEnd.setDate(revenueCalendarStart.getDate() + 6);
  revenueCalendarEnd.setHours(23,59,59,999);
  
  tempRevStart = new Date(revenueCalendarStart);
  tempRevEnd = new Date(revenueCalendarEnd);
  
  updateRevenueDateRangeDisplay();
  loadRevenueChart(formatDate(revenueCalendarStart), formatDate(revenueCalendarEnd));
  
  var btn = $('revenue-clear-filter');
  if (btn) btn.classList.remove('show');
}

updateRevenueDateRangeDisplay();
loadRevenueChart(formatDate(revenueCalendarStart), formatDate(revenueCalendarEnd));
