// Khung giờ vàng (Bar Chart - Global & Slot-based Brand Breakdown)
var heatmapChartInstance = null;
var heatmapCurrentView = 'hour'; // 'hour' | 'day'
var heatmapLastData = null;
var selectedHeatmapSlot = null;

// Heatmap Date range states: defaults to current week (Monday to Sunday)
var dInit = new Date();
var dowInit = dInit.getDay();
var diffToMondayInit = dInit.getDate() - dowInit + (dowInit === 0 ? -6 : 1);
var heatmapCalendarStart = new Date(dInit.getFullYear(), dInit.getMonth(), diffToMondayInit);
heatmapCalendarStart.setHours(0,0,0,0);

var heatmapCalendarEnd = new Date(heatmapCalendarStart);
heatmapCalendarEnd.setDate(heatmapCalendarStart.getDate() + 6);
heatmapCalendarEnd.setHours(23,59,59,999);

var tempHeatmapStart = new Date(heatmapCalendarStart);
var tempHeatmapEnd = new Date(heatmapCalendarEnd);

var currentHeatmapCalMonth = new Date().getMonth();
var currentHeatmapCalYear = new Date().getFullYear();

function updateHeatmapDateRangeDisplay() {
  if (heatmapCalendarStart && heatmapCalendarEnd) {
    $('lblHeatmapDateRange').innerText = 'Tuần: ' + formatDisplayDate(heatmapCalendarStart) + ' - ' + formatDisplayDate(heatmapCalendarEnd);
  } else {
    $('lblHeatmapDateRange').innerText = 'Chọn tuần';
  }
}

function highlightCalendarWeek(date) {
  var range = getWeekRange(date);
  var startStr = formatDate(range.monday);
  var endStr = formatDate(range.sunday);
  var todayStr = formatDate(new Date());
  
  var grid = $('gridHeatmapCalendarDays');
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

function clearCalendarWeekHighlight() {
  var grid = $('gridHeatmapCalendarDays');
  if (!grid) return;
  var btns = grid.querySelectorAll('button');
  btns.forEach(function(btn) {
    btn.classList.remove('bg-gold-100/50');
    btn.classList.remove('text-gold-700');
  });
}

function renderHeatmapCalendarGrid() {
  var grid = $('gridHeatmapCalendarDays');
  if (!grid) return;
  grid.innerHTML = '';
  
  var monthLabel = 'Tháng ' + String(currentHeatmapCalMonth + 1).padStart(2, '0') + '/' + currentHeatmapCalYear;
  $('lblHeatmapMonthYear').innerText = monthLabel;
  
  var firstDayIndex = (new Date(currentHeatmapCalYear, currentHeatmapCalMonth, 1).getDay() + 6) % 7; // Monday = 0
  var totalDays = new Date(currentHeatmapCalYear, currentHeatmapCalMonth + 1, 0).getDate();
  var prevTotalDays = 30;
  try {
    prevTotalDays = new Date(currentHeatmapCalYear, currentHeatmapCalMonth, 0).getDate();
  } catch(_) {}

  for (var i = firstDayIndex - 1; i >= 0; i--) {
    var dayNum = prevTotalDays - i;
    var dDiv = document.createElement('div');
    dDiv.className = 'w-8 h-8 flex items-center justify-center mx-auto text-gray-300 cursor-not-allowed select-none';
    dDiv.innerText = dayNum;
    grid.appendChild(dDiv);
  }
  
  for (var day = 1; day <= totalDays; day++) {
    var dateObj = new Date(currentHeatmapCalYear, currentHeatmapCalMonth, day);
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
        if (dStr && dStr <= todayStr) highlightCalendarWeek(new Date(dStr));
      });
      
      dDiv.addEventListener('mouseleave', function() {
        clearCalendarWeekHighlight();
        if (tempHeatmapStart) highlightCalendarWeek(tempHeatmapStart);
      });

      dDiv.addEventListener('click', function() {
        var clickedDateStr = this.getAttribute('data-date');
        if (!clickedDateStr || clickedDateStr > todayStr) return;
        var range = getWeekRange(new Date(clickedDateStr));
        tempHeatmapStart = range.monday;
        tempHeatmapEnd = range.sunday;
        
        clearCalendarWeekHighlight();
        highlightCalendarWeek(tempHeatmapStart);
      });
    }
    grid.appendChild(dDiv);
  }
  
  if (tempHeatmapStart) {
    highlightCalendarWeek(tempHeatmapStart);
  }
}

if ($('btnOpenHeatmapCalendar')) {
  $('btnOpenHeatmapCalendar').addEventListener('click', function(e) {
    e.stopPropagation();
    var popup = $('heatmapCalendarPopup');
    if (popup) {
      popup.classList.toggle('hidden');
      if (!popup.classList.contains('hidden')) {
        tempHeatmapStart = new Date(heatmapCalendarStart);
        tempHeatmapEnd = new Date(heatmapCalendarEnd);
        currentHeatmapCalMonth = tempHeatmapStart.getMonth();
        currentHeatmapCalYear = tempHeatmapStart.getFullYear();
        renderHeatmapCalendarGrid();
      }
    }
  });
}

if ($('btnHeatmapPrevMonth')) {
  $('btnHeatmapPrevMonth').addEventListener('click', function(e) {
    e.stopPropagation();
    currentHeatmapCalMonth--;
    if (currentHeatmapCalMonth < 0) {
      currentHeatmapCalMonth = 11;
      currentHeatmapCalYear--;
    }
    renderHeatmapCalendarGrid();
  });
}

if ($('btnHeatmapNextMonth')) {
  $('btnHeatmapNextMonth').addEventListener('click', function(e) {
    e.stopPropagation();
    currentHeatmapCalMonth++;
    if (currentHeatmapCalMonth > 11) {
      currentHeatmapCalMonth = 0;
      currentHeatmapCalYear++;
    }
    renderHeatmapCalendarGrid();
  });
}

if ($('btnHeatmapCancelCalendar')) {
  $('btnHeatmapCancelCalendar').addEventListener('click', function(e) {
    e.stopPropagation();
    $('heatmapCalendarPopup').classList.add('hidden');
  });
}

if ($('btnHeatmapApplyCalendar')) {
  $('btnHeatmapApplyCalendar').addEventListener('click', function(e) {
    e.stopPropagation();
    heatmapCalendarStart = new Date(tempHeatmapStart);
    heatmapCalendarEnd = new Date(tempHeatmapEnd);
    updateHeatmapDateRangeDisplay();
    $('heatmapCalendarPopup').classList.add('hidden');
    renderHeatmap('all', getHeatmapMetric(), formatDate(heatmapCalendarStart), formatDate(heatmapCalendarEnd));
  });
}

if ($('heatmapDatePickerWrapper')) {
  document.addEventListener('click', function(e) {
    var container = $('heatmapDatePickerWrapper');
    var popup = $('heatmapCalendarPopup');
    if (container && popup && !container.contains(e.target) && !popup.classList.contains('hidden')) {
      popup.classList.add('hidden');
    }
  });
}

function getHeatmapMetric() {
  var active = $('heatmapMetricSwitcher') ? $('heatmapMetricSwitcher').querySelector('.metric-btn.active') : null;
  return active ? active.dataset.metric : 'purchase';
}

function renderHeatmap(brandId, metric, startDate, endDate) {
  var bId = brandId || 'all';
  var m = metric || getHeatmapMetric();
  var url = '/api/funnel/brand-heatmap?metric=' + encodeURIComponent(m);
  if (bId && bId !== 'all') {
    url += '&brandId=' + encodeURIComponent(bId);
  }
  if (startDate && endDate) {
    url += '&startDate=' + startDate + '&endDate=' + endDate;
  }

  fetch(url, { headers: H, credentials: 'same-origin' })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (!res.success || !res.data) {
        var container = $('heatmapContainer');
        if (container) container.innerHTML = '<p class="text-gray-400 text-center py-10">Chưa có dữ liệu</p>';
        var brandList = $('heatmapBrandList');
        if (brandList) brandList.innerHTML = '<p class="text-xs text-gray-400 italic py-4 text-center">Chưa có dữ liệu</p>';
        return;
      }
      heatmapLastData = res.data;
      selectedHeatmapSlot = null;
      drawHeatmapBarChart(res.data, heatmapCurrentView);
      updateHeatmapSidePanel(res.data.brandBreakdown, null, null);
      if (typeof checkHeatmapFiltersActive === 'function') checkHeatmapFiltersActive();
    })
    .catch(function(err){
      console.error('Heatmap render error:', err);
      var container = $('heatmapContainer');
      if (container) container.innerHTML = '<p class="text-gray-400 text-center py-10">Lỗi tải dữ liệu</p>';
      var brandList = $('heatmapBrandList');
      if (brandList) brandList.innerHTML = '<p class="text-xs text-gray-400 italic py-4 text-center">Lỗi tải dữ liệu</p>';
    });
}

function drawHeatmapBarChart(data, view) {
  heatmapLastData = data;
  var container = $('heatmapContainer');
  if (!container) return;

  if (heatmapChartInstance) { heatmapChartInstance.destroy(); heatmapChartInstance = null; }

  container.innerHTML = '<canvas id="heatmapCanvas" style="width:100%;max-height:260px;"></canvas>';
  var canvas = document.getElementById('heatmapCanvas');
  if (!canvas) return;

  var labels, values;
  var matrix = data.matrix || [];

  var metricColors = {
    purchase:       { bg: 'rgba(99,102,241,0.75)',  border: '#6366f1' },
    add_to_cart:    { bg: 'rgba(16,185,129,0.75)',  border: '#10b981' },
    reach_checkout: { bg: 'rgba(245,158,11,0.75)',  border: '#f59e0b' },
  };
  var activeMetric = $('heatmapMetricSwitcher') ? ($('heatmapMetricSwitcher').querySelector('.metric-btn.active') || {}).dataset : {};
  var colorKey = (activeMetric && activeMetric.metric) || 'purchase';
  var colors = metricColors[colorKey] || metricColors.purchase;

  if (view === 'hour') {
    labels = [];
    values = [];
    for (var h = 0; h < 24; h++) {
      labels.push(String(h).padStart(2,'0') + ':00');
      var total = 0;
      for (var d = 0; d < 7; d++) {
        if (matrix[h]) total += (matrix[h][d] || 0);
      }
      values.push(total);
    }
  } else {
    labels = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];
    values = [];
    for (var col = 0; col < 7; col++) {
      var total = 0;
      for (var hr = 0; hr < 24; hr++) {
        if (matrix[hr]) total += (matrix[hr][col] || 0);
      }
      values.push(total);
    }
  }

  var metricLabel = { purchase: 'Mua hàng', add_to_cart: 'Thêm giỏ hàng', reach_checkout: 'Thanh toán' };
  var datasetLabel = (metricLabel[colorKey] || 'Tổng') + ' — ' + (data.brandName || 'Tất cả thương hiệu');

  var maxVal = Math.max.apply(null, values);
  var bgColors = values.map(function(v) {
    return v === maxVal && maxVal > 0 ? colors.border : colors.bg;
  });

  heatmapChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: datasetLabel,
        data: values,
        backgroundColor: bgColors,
        borderColor: colors.border,
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: function(e, elements) {
        if (elements && elements.length > 0) {
          var idx = elements[0].index;
          selectHeatmapSlot(view, idx);
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              return ' ' + fmt(ctx.parsed.y);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 }, color: '#6b7280', maxRotation: view === 'hour' ? 45 : 0 }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: {
            font: { size: 11 }, color: '#6b7280',
            callback: function(v) { return Number.isInteger(v) ? fmt(v) : ''; }
          }
        }
      }
    }
  });
}

function selectHeatmapSlot(type, index) {
  selectedHeatmapSlot = { type: type, index: index };
  if (heatmapLastData && heatmapLastData.brandBreakdown) {
    updateHeatmapSidePanel(heatmapLastData.brandBreakdown, type, index);
  }
}

var heatmapPulseTimer = null;
var activeHeatmapBrand = null;

function highlightHeatmapBrandOnChart(brandName, elem) {
  if (!heatmapChartInstance || !heatmapLastData) return;

  var brandList = $('heatmapBrandList');
  if (brandList) {
    brandList.querySelectorAll('.heatmap-brand-item').forEach(function(el) {
      el.classList.remove('border-indigo-400', 'ring-1', 'ring-indigo-300');
    });
  }

  if (activeHeatmapBrand === brandName) {
    activeHeatmapBrand = null;
    if (heatmapPulseTimer) { clearInterval(heatmapPulseTimer); heatmapPulseTimer = null; }
    restoreHeatmapBarColors();
    return;
  }

  activeHeatmapBrand = brandName;
  if (elem) {
    elem.classList.add('border-indigo-400', 'ring-1', 'ring-indigo-300');
  }

  var breakdown = heatmapLastData.brandBreakdown || {};
  var matchingIndices = [];

  if (heatmapCurrentView === 'hour') {
    var byHour = breakdown.byHour || {};
    for (var h = 0; h < 24; h++) {
      var itemsH = byHour[h] || [];
      if (itemsH.some(function(b) { return b.brandName === brandName; })) {
        matchingIndices.push(h);
      }
    }
  } else {
    var byDay = breakdown.byDay || {};
    for (var d = 0; d < 7; d++) {
      var itemsD = byDay[d] || [];
      if (itemsD.some(function(b) { return b.brandName === brandName; })) {
        matchingIndices.push(d);
      }
    }
  }

  if (matchingIndices.length === 0) {
    if (typeof showToast === 'function') {
      showToast('Thương hiệu "' + brandName + '" chưa có giao dịch trong các mốc này', 'info');
    }
    activeHeatmapBrand = null;
    if (elem) elem.classList.remove('border-indigo-400', 'ring-1', 'ring-indigo-300');
    return;
  }

  if (heatmapPulseTimer) { clearInterval(heatmapPulseTimer); heatmapPulseTimer = null; }

  var ds = heatmapChartInstance.data.datasets[0];
  var totalItems = (heatmapCurrentView === 'hour') ? 24 : 7;

  var metricColors = {
    purchase:       { bg: 'rgba(99,102,241,0.75)',  border: '#6366f1' },
    add_to_cart:    { bg: 'rgba(16,185,129,0.75)',  border: '#10b981' },
    reach_checkout: { bg: 'rgba(245,158,11,0.75)',  border: '#f59e0b' },
  };
  var activeMetricKey = getHeatmapMetric();
  var defaultColors = metricColors[activeMetricKey] || metricColors.purchase;

  var pulseState = false;
  var pulseCount = 0;
  var maxPulses = 7;

  heatmapPulseTimer = setInterval(function() {
    pulseState = !pulseState;
    pulseCount++;

    var borderColors = [];
    var borderWidths = [];
    var bgColors = [];

    for (var i = 0; i < totalItems; i++) {
      if (matchingIndices.indexOf(i) !== -1) {
        bgColors.push(defaultColors.bg);
        borderColors.push(pulseState ? '#f59e0b' : defaultColors.border);
        borderWidths.push(pulseState ? 2.5 : 1.5);
      } else {
        bgColors.push('rgba(229,231,235,0.4)');
        borderColors.push('rgba(209,213,219,0.4)');
        borderWidths.push(1);
      }
    }

    ds.backgroundColor = bgColors;
    ds.borderColor = borderColors;
    ds.borderWidth = borderWidths;
    heatmapChartInstance.update('none');

    if (pulseCount >= maxPulses) {
      clearInterval(heatmapPulseTimer);
      heatmapPulseTimer = null;
      var finalBorders = [];
      var finalWidths = [];
      var finalBg = [];
      for (var j = 0; j < totalItems; j++) {
        if (matchingIndices.indexOf(j) !== -1) {
          finalBg.push(defaultColors.bg);
          finalBorders.push('#f59e0b');
          finalWidths.push(1.8);
        } else {
          finalBg.push('rgba(229,231,235,0.4)');
          finalBorders.push('rgba(209,213,219,0.4)');
          finalWidths.push(1);
        }
      }
      ds.backgroundColor = finalBg;
      ds.borderColor = finalBorders;
      ds.borderWidth = finalWidths;
      heatmapChartInstance.update('none');
    }
  }, 260);
}

function restoreHeatmapBarColors() {
  if (!heatmapChartInstance || !heatmapLastData) return;
  drawHeatmapBarChart(heatmapLastData, heatmapCurrentView);
}

function resetHeatmapSelection() {
  selectedHeatmapSlot = null;
  activeHeatmapBrand = null;
  if (heatmapPulseTimer) { clearInterval(heatmapPulseTimer); heatmapPulseTimer = null; }
  restoreHeatmapBarColors();
  if (heatmapLastData && heatmapLastData.brandBreakdown) {
    updateHeatmapSidePanel(heatmapLastData.brandBreakdown, null, null);
  }
}

function updateHeatmapSidePanel(breakdown, type, index) {
  var subtitle = $('lblHeatmapSideSubtitle');
  var resetBtn = $('btnHeatmapResetSelection');
  var brandList = $('heatmapBrandList');

  if (!brandList) return;

  var items = [];
  var dayNames = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];

  if (type === 'hour') {
    var hourStr = String(index).padStart(2, '0') + ':00';
    if (subtitle) {
      subtitle.innerText = 'Thương hiệu lúc ' + hourStr;
      subtitle.classList.remove('hidden');
    }
    if (resetBtn) resetBtn.classList.remove('hidden');
    items = (breakdown && breakdown.byHour && breakdown.byHour[index]) || [];
  } else if (type === 'day') {
    var dName = dayNames[index] || ('Thứ ' + (index + 2));
    if (subtitle) {
      subtitle.innerText = 'Thương hiệu ' + dName;
      subtitle.classList.remove('hidden');
    }
    if (resetBtn) resetBtn.classList.remove('hidden');
    items = (breakdown && breakdown.byDay && breakdown.byDay[index]) || [];
  } else {
    if (subtitle) {
      subtitle.innerText = '';
      subtitle.classList.add('hidden');
    }
    if (resetBtn) resetBtn.classList.add('hidden');
    items = (breakdown && breakdown.overall) || [];
  }

  if (!items || items.length === 0) {
    brandList.innerHTML = '<p class="text-xs text-gray-400 italic py-4 text-center">Chưa có dữ liệu</p>';
    return;
  }

  var html = '';
  items.slice(0, 50).forEach(function(b) {
    var bNameEsc = escapeHtml(b.brandName);
    var bNameJs = bNameEsc.replace(/'/g, "\\'");
    var isActive = (activeHeatmapBrand === b.brandName);
    var activeClass = isActive ? ' ring-2 ring-indigo-400 bg-indigo-50 border-indigo-300' : '';
    html += '<div class="heatmap-brand-item flex items-center justify-between py-1.5 px-2 bg-white rounded-lg border border-gray-100 shadow-2xs hover:border-indigo-400 hover:bg-indigo-50/50 transition-all cursor-pointer select-none' + activeClass + '" data-brand="' + bNameEsc + '" onclick="highlightHeatmapBrandOnChart(\'' + bNameJs + '\', this)">' +
              '<span class="text-xs font-semibold text-gray-700 truncate mr-2" title="' + bNameEsc + '">' + bNameEsc + '</span>' +
              '<span class="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full shrink-0">' + fmt(b.count) + '</span>' +
            '</div>';
  });
  brandList.innerHTML = html;
}

if ($('heatmapViewSwitcher')) {
  $('heatmapViewSwitcher').querySelectorAll('.metric-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      $('heatmapViewSwitcher').querySelectorAll('.metric-btn').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      heatmapCurrentView = this.dataset.view;
      if (heatmapLastData) {
        drawHeatmapBarChart(heatmapLastData, heatmapCurrentView);
        resetHeatmapSelection();
      }
    });
  });
}

if ($('heatmapMetricSwitcher')) {
  $('heatmapMetricSwitcher').querySelectorAll('.metric-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      $('heatmapMetricSwitcher').querySelectorAll('.metric-btn').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      renderHeatmap('all', btn.dataset.metric, formatDate(heatmapCalendarStart), formatDate(heatmapCalendarEnd));
    });
  });
}

function checkHeatmapFiltersActive() {
  var d = new Date();
  var dow = d.getDay();
  var diff = d.getDate() - dow + (dow === 0 ? -6 : 1);
  var currentWeekMon = new Date(d.getFullYear(), d.getMonth(), diff);
  currentWeekMon.setHours(0,0,0,0);
  
  var isDefaultWeek = (heatmapCalendarStart && heatmapCalendarStart.getTime() === currentWeekMon.getTime());
  var isDefaultView = (heatmapCurrentView === 'hour');
  var isDefaultMetric = (getHeatmapMetric() === 'purchase');
  
  var isActive = !isDefaultWeek || !isDefaultView || !isDefaultMetric || selectedHeatmapSlot !== null;
  
  var btn = $('heatmap-clear-filter');
  if (btn) {
    if (isActive) {
      btn.classList.add('show');
    } else {
      btn.classList.remove('show');
    }
  }
}

function resetHeatmapFilters(e) {
  if (e) e.preventDefault();
  
  var d = new Date();
  var dow = d.getDay();
  var diff = d.getDate() - dow + (dow === 0 ? -6 : 1);
  heatmapCalendarStart = new Date(d.getFullYear(), d.getMonth(), diff);
  heatmapCalendarStart.setHours(0,0,0,0);
  
  heatmapCalendarEnd = new Date(heatmapCalendarStart);
  heatmapCalendarEnd.setDate(heatmapCalendarStart.getDate() + 6);
  heatmapCalendarEnd.setHours(23,59,59,999);
  
  tempHeatmapStart = new Date(heatmapCalendarStart);
  tempHeatmapEnd = new Date(heatmapCalendarEnd);
  
  updateHeatmapDateRangeDisplay();
  
  heatmapCurrentView = 'hour';
  if ($('heatmapViewSwitcher')) {
    $('heatmapViewSwitcher').querySelectorAll('.metric-btn').forEach(function(b) {
      if (b.dataset.view === 'hour') b.classList.add('active');
      else b.classList.remove('active');
    });
  }
  
  if ($('heatmapMetricSwitcher')) {
    $('heatmapMetricSwitcher').querySelectorAll('.metric-btn').forEach(function(b) {
      if (b.dataset.metric === 'purchase') b.classList.add('active');
      else b.classList.remove('active');
    });
  }
  
  renderHeatmap('all', 'purchase', formatDate(heatmapCalendarStart), formatDate(heatmapCalendarEnd));
  
  var btn = $('heatmap-clear-filter');
  if (btn) btn.classList.remove('show');
}

updateHeatmapDateRangeDisplay();
renderHeatmap('all', getHeatmapMetric(), formatDate(heatmapCalendarStart), formatDate(heatmapCalendarEnd));
