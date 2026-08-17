// Trend Chart (Global & Per-Date Brand Breakdown)
var trendChart = null;
var TR = function(){ return $('chartTrend'); };
var trendBrandId = 'all';
var trendLastData = null;
var selectedTrendDate = null;

// Trend Calendar States
var currentTrendCalMonth = new Date().getMonth();
var currentTrendCalYear = new Date().getFullYear();

// Default values: current week (Monday to Sunday)
var dTInit = new Date();
var dowTInit = dTInit.getDay();
var diffToMondayTInit = dTInit.getDate() - dowTInit + (dowTInit === 0 ? -6 : 1);
var trendCalendarStart = new Date(dTInit.getFullYear(), dTInit.getMonth(), diffToMondayTInit);
trendCalendarStart.setHours(0,0,0,0);

var trendCalendarEnd = new Date(trendCalendarStart);
trendCalendarEnd.setDate(trendCalendarStart.getDate() + 6);
trendCalendarEnd.setHours(23,59,59,999);

var tempTrendStart = new Date(trendCalendarStart);
var tempTrendEnd = new Date(trendCalendarEnd);

function renderTrend(brandId, metric, startDate, endDate) {
  var bId = brandId || 'all';
  var m = metric || getActiveMetric();
  var url = '/api/funnel/brand-timeseries?metric=' + encodeURIComponent(m);
  if (bId && bId !== 'all') {
    url += '&brandId=' + encodeURIComponent(bId);
  }
  if (startDate && endDate) {
    url += '&startDate=' + startDate + '&endDate=' + endDate;
  }
  
  fetch(url, { headers: H, credentials: 'same-origin' })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (!res.success || !res.data || !res.data.current) {
        if (trendChart) { trendChart.destroy(); trendChart = null; }
        var brandList = $('trendBrandList');
        if (brandList) brandList.innerHTML = '<p class="text-xs text-gray-400 italic py-4 text-center">Chưa có dữ liệu</p>';
        return;
      }
      var d = res.data;
      trendLastData = d;
      selectedTrendDate = null;

      var currentList = d.current || [];
      var benchmarkList = d.benchmark || [];

      var labels = currentList.map(function(p){ return p.date ? p.date.substring(5) : ''; });
      var curVals = currentList.map(function(p){ return p.value || 0; });
      var bmkVals = benchmarkList.map(function(p){ return p.value || 0; });
      var maxV = Math.max.apply(null, curVals.concat(bmkVals)) || 1;

      if (trendChart) { trendChart.destroy(); trendChart = null; }
      if (!TR()) return;

      trendChart = new Chart(TR().getContext('2d'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: 'Kỳ trước', data: bmkVals, borderColor: 'rgba(148,163,184,0.5)', backgroundColor: 'rgba(148,163,184,0.12)', borderDash: [6, 3], borderWidth: 1.5, fill: true, tension: 0.3, pointRadius: 0, pointHitRadius: 4 },
            { label: 'Hiện tại', data: curVals, borderColor: '#C9A96E', backgroundColor: 'rgba(201,169,110,0.06)', borderWidth: 2.5, fill: false, tension: 0.3, pointRadius: 4, pointBackgroundColor: '#C9A96E', pointBorderColor: '#fff', pointBorderWidth: 2 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          onClick: function(e, elements) {
            if (elements && elements.length > 0) {
              var idx = elements[0].index;
              var item = currentList[idx];
              if (item && item.date) {
                selectTrendDatePoint(item.date);
              }
            }
          },
          plugins: {
            legend: { labels: { usePointStyle: true, padding: 16, font: { size: 12 } } },
            tooltip: { callbacks: { label: function(ctx){ return ctx.dataset.label + ': ' + fmt(ctx.parsed.y); } } }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#787774' } },
            y: { beginAtZero: true, max: Math.ceil(maxV * 1.2), grid: { color: 'rgba(201,169,110,0.06)' }, ticks: { font: { size: 11 }, color: '#787774', stepSize: Math.max(1, Math.ceil(maxV/5)) } }
          },
          animation: { duration: 600, easing: 'easeInOutQuart' }
        }
      });

      updateTrendSidePanel(d.brandBreakdown, null);
      if (typeof checkTrendFiltersActive === 'function') checkTrendFiltersActive();
    })
    .catch(function(err){
      console.error('Trend render error:', err);
      if (trendChart) { trendChart.destroy(); trendChart = null; }
      var brandList = $('trendBrandList');
      if (brandList) brandList.innerHTML = '<p class="text-xs text-gray-400 italic py-4 text-center">Lỗi tải dữ liệu</p>';
    });
}

function selectTrendDatePoint(dateKey) {
  selectedTrendDate = dateKey;
  if (trendLastData && trendLastData.brandBreakdown) {
    updateTrendSidePanel(trendLastData.brandBreakdown, dateKey);
  }
}

var trendPulseTimer = null;
var activeTrendBrand = null;

function highlightTrendBrandOnChart(brandName, elem) {
  if (!trendChart || !trendLastData) return;

  var brandList = $('trendBrandList');
  if (brandList) {
    brandList.querySelectorAll('.trend-brand-item').forEach(function(el) {
      el.classList.remove('border-amber-400', 'ring-1', 'ring-amber-300');
    });
  }

  if (activeTrendBrand === brandName) {
    activeTrendBrand = null;
    if (trendPulseTimer) { clearInterval(trendPulseTimer); trendPulseTimer = null; }
    resetTrendChartPoints();
    return;
  }

  activeTrendBrand = brandName;
  if (elem) {
    elem.classList.add('border-amber-400', 'ring-1', 'ring-amber-300');
  }

  var currentList = trendLastData.current || [];
  var benchmarkList = trendLastData.benchmark || [];
  var byDate = (trendLastData.brandBreakdown && trendLastData.brandBreakdown.byDate) || {};

  var curIndices = [];
  var bmkIndices = [];

  currentList.forEach(function(p, idx) {
    var curDate = p.date;
    var itemsForDate = byDate[curDate] || [];
    if (itemsForDate.some(function(b) { return b.brandName === brandName; })) {
      curIndices.push(idx);
    }
  });

  benchmarkList.forEach(function(p, idx) {
    var bmkDate = p.date;
    var itemsForDate = byDate[bmkDate] || [];
    if (itemsForDate.some(function(b) { return b.brandName === brandName; })) {
      bmkIndices.push(idx);
    }
  });

  if (curIndices.length === 0 && bmkIndices.length === 0) {
    if (typeof showToast === 'function') {
      showToast('Thương hiệu "' + brandName + '" chưa có giao dịch trong mốc này', 'info');
    }
    activeTrendBrand = null;
    if (elem) elem.classList.remove('border-amber-400', 'ring-1', 'ring-amber-300');
    return;
  }

  if (trendPulseTimer) { clearInterval(trendPulseTimer); trendPulseTimer = null; }

  var dsCurrent = trendChart.data.datasets[1];
  var dsBenchmark = trendChart.data.datasets[0];

  var defaultCurRadius = currentList.map(function(){ return 4; });
  var defaultCurBw = currentList.map(function(){ return 2; });
  var defaultCurBc = currentList.map(function(){ return '#ffffff'; });
  var defaultCurBg = currentList.map(function(){ return '#C9A96E'; });

  var defaultBmkRadius = benchmarkList.map(function(){ return 0; });
  var defaultBmkBw = benchmarkList.map(function(){ return 1.5; });
  var defaultBmkBc = benchmarkList.map(function(){ return '#ffffff'; });
  var defaultBmkBg = benchmarkList.map(function(){ return 'rgba(148,163,184,0.5)'; });

  var pulseState = false;
  var pulseCount = 0;
  var maxPulses = 7;

  trendPulseTimer = setInterval(function() {
    pulseState = !pulseState;
    pulseCount++;

    var curR = defaultCurRadius.slice();
    var curBw = defaultCurBw.slice();
    var curBc = defaultCurBc.slice();
    var curBg = defaultCurBg.slice();

    curIndices.forEach(function(idx) {
      curR[idx] = pulseState ? 8 : 5;
      curBw[idx] = pulseState ? 3 : 1.5;
      curBc[idx] = pulseState ? '#f59e0b' : '#d97706';
      curBg[idx] = '#C9A96E';
    });

    var bmkR = defaultBmkRadius.slice();
    var bmkBw = defaultBmkBw.slice();
    var bmkBc = defaultBmkBc.slice();
    var bmkBg = defaultBmkBg.slice();

    bmkIndices.forEach(function(idx) {
      bmkR[idx] = pulseState ? 7 : 4;
      bmkBw[idx] = pulseState ? 2.5 : 1;
      bmkBc[idx] = pulseState ? '#f59e0b' : '#64748b';
      bmkBg[idx] = 'rgba(148,163,184,0.6)';
    });

    dsCurrent.pointRadius = curR;
    dsCurrent.pointBorderWidth = curBw;
    dsCurrent.pointBorderColor = curBc;
    dsCurrent.pointBackgroundColor = curBg;

    dsBenchmark.pointRadius = bmkR;
    dsBenchmark.pointBorderWidth = bmkBw;
    dsBenchmark.pointBorderColor = bmkBc;
    dsBenchmark.pointBackgroundColor = bmkBg;

    trendChart.update('none');

    if (pulseCount >= maxPulses) {
      clearInterval(trendPulseTimer);
      trendPulseTimer = null;
      curIndices.forEach(function(idx) {
        curR[idx] = 6;
        curBw[idx] = 2;
        curBc[idx] = '#f59e0b';
      });
      bmkIndices.forEach(function(idx) {
        bmkR[idx] = 5;
        bmkBw[idx] = 2;
        bmkBc[idx] = '#f59e0b';
      });
      dsCurrent.pointRadius = curR;
      dsCurrent.pointBorderWidth = curBw;
      dsCurrent.pointBorderColor = curBc;
      dsCurrent.pointBackgroundColor = curBg;

      dsBenchmark.pointRadius = bmkR;
      dsBenchmark.pointBorderWidth = bmkBw;
      dsBenchmark.pointBorderColor = bmkBc;
      dsBenchmark.pointBackgroundColor = bmkBg;
      trendChart.update('none');
    }
  }, 260);
}

function resetTrendChartPoints() {
  if (!trendChart) return;
  var dsCurrent = trendChart.data.datasets[1];
  var dsBenchmark = trendChart.data.datasets[0];
  if (dsCurrent) {
    dsCurrent.pointRadius = 4;
    dsCurrent.pointBorderWidth = 2;
    dsCurrent.pointBorderColor = '#ffffff';
    dsCurrent.pointBackgroundColor = '#C9A96E';
  }
  if (dsBenchmark) {
    dsBenchmark.pointRadius = 0;
    dsBenchmark.pointBorderWidth = 1.5;
    dsBenchmark.pointBorderColor = '#ffffff';
    dsBenchmark.pointBackgroundColor = 'rgba(148,163,184,0.5)';
  }
  trendChart.update('none');
}

function resetTrendDateSelection() {
  selectedTrendDate = null;
  activeTrendBrand = null;
  if (trendPulseTimer) { clearInterval(trendPulseTimer); trendPulseTimer = null; }
  resetTrendChartPoints();
  if (trendLastData && trendLastData.brandBreakdown) {
    updateTrendSidePanel(trendLastData.brandBreakdown, null);
  }
}

function updateTrendSidePanel(breakdown, dateKey) {
  var subtitle = $('lblTrendSideSubtitle');
  var resetBtn = $('btnTrendResetSelection');
  var brandList = $('trendBrandList');

  if (!brandList) return;

  var items = [];
  if (dateKey) {
    var parts = dateKey.split('-');
    var formattedDate = parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : dateKey;
    if (subtitle) {
      subtitle.innerText = 'Thương hiệu ngày ' + formattedDate;
      subtitle.classList.remove('hidden');
    }
    if (resetBtn) resetBtn.classList.remove('hidden');
    items = (breakdown && breakdown.byDate && breakdown.byDate[dateKey]) || [];
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
    var isActive = (activeTrendBrand === b.brandName);
    var activeClass = isActive ? ' ring-2 ring-amber-400 bg-amber-50 border-amber-300' : '';
    html += '<div class="trend-brand-item flex items-center justify-between py-1.5 px-2 bg-white rounded-lg border border-gray-100 shadow-2xs hover:border-amber-400 hover:bg-amber-50/50 transition-all cursor-pointer select-none' + activeClass + '" data-brand="' + bNameEsc + '" onclick="highlightTrendBrandOnChart(\'' + bNameJs + '\', this)">' +
              '<span class="text-xs font-semibold text-gray-700 truncate mr-2" title="' + bNameEsc + '">' + bNameEsc + '</span>' +
              '<span class="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full shrink-0">' + fmt(b.count) + '</span>' +
            '</div>';
  });
  brandList.innerHTML = html;
}

function getActiveMetric() {
  var active = $('metricSwitcher') ? $('metricSwitcher').querySelector('.metric-btn.active') : null;
  return active ? active.dataset.metric : 'add_to_cart';
}

function updateTrendDateRangeDisplay() {
  if (trendCalendarStart && trendCalendarEnd) {
    $('lblTrendDateRange').innerText = 'Tuần: ' + formatDisplayDate(trendCalendarStart) + ' - ' + formatDisplayDate(trendCalendarEnd);
  } else {
    $('lblTrendDateRange').innerText = 'Chọn tuần';
  }
}

function highlightTrendCalendarWeek(date) {
  var range = getWeekRange(date);
  var startStr = formatDate(range.monday);
  var endStr = formatDate(range.sunday);
  var todayStr = formatDate(new Date());
  
  var grid = $('gridTrendCalendarDays');
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

function clearTrendCalendarWeekHighlight() {
  var grid = $('gridTrendCalendarDays');
  if (!grid) return;
  var btns = grid.querySelectorAll('button');
  btns.forEach(function(btn) {
    btn.classList.remove('bg-gold-100/50');
    btn.classList.remove('text-gold-700');
  });
}

function renderTrendCalendarGrid() {
  var grid = $('gridTrendCalendarDays');
  if (!grid) return;
  grid.innerHTML = '';
  
  var monthLabel = 'Tháng ' + String(currentTrendCalMonth + 1).padStart(2, '0') + '/' + currentTrendCalYear;
  $('lblTrendMonthYear').innerText = monthLabel;
  
  var firstDayIndex = (new Date(currentTrendCalYear, currentTrendCalMonth, 1).getDay() + 6) % 7; // Monday = 0
  var totalDays = new Date(currentTrendCalYear, currentTrendCalMonth + 1, 0).getDate();
  var prevTotalDays = 30;
  try {
    prevTotalDays = new Date(currentTrendCalYear, currentTrendCalMonth, 0).getDate();
  } catch(_) {}

  for (var i = firstDayIndex - 1; i >= 0; i--) {
    var dayNum = prevTotalDays - i;
    var dDiv = document.createElement('div');
    dDiv.className = 'w-8 h-8 flex items-center justify-center mx-auto text-gray-300 cursor-not-allowed select-none';
    dDiv.innerText = dayNum;
    grid.appendChild(dDiv);
  }
  
  for (var day = 1; day <= totalDays; day++) {
    var dateObj = new Date(currentTrendCalYear, currentTrendCalMonth, day);
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
        if (dStr && dStr <= todayStr) highlightTrendCalendarWeek(new Date(dStr));
      });
      
      dDiv.addEventListener('mouseleave', function() {
        clearTrendCalendarWeekHighlight();
        if (tempTrendStart) highlightTrendCalendarWeek(tempTrendStart);
      });

      dDiv.addEventListener('click', function() {
        var clickedDateStr = this.getAttribute('data-date');
        if (!clickedDateStr || clickedDateStr > todayStr) return;
        var range = getWeekRange(new Date(clickedDateStr));
        tempTrendStart = range.monday;
        tempTrendEnd = range.sunday;
        
        clearTrendCalendarWeekHighlight();
        highlightTrendCalendarWeek(tempTrendStart);
      });
    }
    grid.appendChild(dDiv);
  }
  
  if (tempTrendStart) {
    highlightTrendCalendarWeek(tempTrendStart);
  }
}

if ($('btnOpenTrendCalendar')) {
  $('btnOpenTrendCalendar').addEventListener('click', function(e) {
    e.stopPropagation();
    var popup = $('trendCalendarPopup');
    if (popup) {
      popup.classList.toggle('hidden');
      if (!popup.classList.contains('hidden')) {
        tempTrendStart = new Date(trendCalendarStart);
        tempTrendEnd = new Date(trendCalendarEnd);
        currentTrendCalMonth = tempTrendStart.getMonth();
        currentTrendCalYear = tempTrendStart.getFullYear();
        renderTrendCalendarGrid();
      }
    }
  });
}

if ($('btnTrendPrevMonth')) {
  $('btnTrendPrevMonth').addEventListener('click', function(e) {
    e.stopPropagation();
    currentTrendCalMonth--;
    if (currentTrendCalMonth < 0) {
      currentTrendCalMonth = 11;
      currentTrendCalYear--;
    }
    renderTrendCalendarGrid();
  });
}

if ($('btnTrendNextMonth')) {
  $('btnTrendNextMonth').addEventListener('click', function(e) {
    e.stopPropagation();
    currentTrendCalMonth++;
    if (currentTrendCalMonth > 11) {
      currentTrendCalMonth = 0;
      currentTrendCalYear++;
    }
    renderTrendCalendarGrid();
  });
}

if ($('btnTrendCancelCalendar')) {
  $('btnTrendCancelCalendar').addEventListener('click', function(e) {
    e.stopPropagation();
    $('trendCalendarPopup').classList.add('hidden');
  });
}

if ($('btnTrendApplyCalendar')) {
  $('btnTrendApplyCalendar').addEventListener('click', function(e) {
    e.stopPropagation();
    trendCalendarStart = new Date(tempTrendStart);
    trendCalendarEnd = new Date(tempTrendEnd);
    updateTrendDateRangeDisplay();
    $('trendCalendarPopup').classList.add('hidden');
    renderTrend('all', getActiveMetric(), formatDate(trendCalendarStart), formatDate(trendCalendarEnd));
  });
}

if ($('trendDatePickerWrapper')) {
  document.addEventListener('click', function(e) {
    var container = $('trendDatePickerWrapper');
    var popup = $('trendCalendarPopup');
    if (container && popup && !container.contains(e.target) && !popup.classList.contains('hidden')) {
      popup.classList.add('hidden');
    }
  });
}

if ($('metricSwitcher')) {
  $('metricSwitcher').querySelectorAll('.metric-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      $('metricSwitcher').querySelectorAll('.metric-btn').forEach(function(b){ b.classList.remove('active'); });
      this.classList.add('active');
      var wrapper = $('trendChartWrapper');
      if (wrapper) wrapper.classList.add('is-fading');
      setTimeout(function(){
        renderTrend('all', btn.dataset.metric, formatDate(trendCalendarStart), formatDate(trendCalendarEnd));
        if (wrapper) setTimeout(function(){ wrapper.classList.remove('is-fading'); }, 50);
      }, 200);
    });
  });
}

function checkTrendFiltersActive() {
  var d = new Date();
  var dow = d.getDay();
  var diff = d.getDate() - dow + (dow === 0 ? -6 : 1);
  var currentWeekMon = new Date(d.getFullYear(), d.getMonth(), diff);
  currentWeekMon.setHours(0,0,0,0);
  
  var isDefaultWeek = (trendCalendarStart && trendCalendarStart.getTime() === currentWeekMon.getTime());
  var isDefaultMetric = (getActiveMetric() === 'add_to_cart');
  
  var isActive = !isDefaultWeek || !isDefaultMetric || selectedTrendDate !== null;
  
  var btn = $('trend-clear-filter');
  if (btn) {
    if (isActive) {
      btn.classList.add('show');
    } else {
      btn.classList.remove('show');
    }
  }
}

function resetTrendFilters(e) {
  if (e) e.preventDefault();
  
  var d = new Date();
  var dow = d.getDay();
  var diff = d.getDate() - dow + (dow === 0 ? -6 : 1);
  trendCalendarStart = new Date(d.getFullYear(), d.getMonth(), diff);
  trendCalendarStart.setHours(0,0,0,0);
  
  trendCalendarEnd = new Date(trendCalendarStart);
  trendCalendarEnd.setDate(trendCalendarStart.getDate() + 6);
  trendCalendarEnd.setHours(23,59,59,999);
  
  tempTrendStart = new Date(trendCalendarStart);
  tempTrendEnd = new Date(trendCalendarEnd);
  
  updateTrendDateRangeDisplay();
  
  if ($('metricSwitcher')) {
    $('metricSwitcher').querySelectorAll('.metric-btn').forEach(function(b) {
      if (b.dataset.metric === 'add_to_cart') b.classList.add('active');
      else b.classList.remove('active');
    });
  }
  
  renderTrend('all', 'add_to_cart', formatDate(trendCalendarStart), formatDate(trendCalendarEnd));
  
  var btn = $('trend-clear-filter');
  if (btn) btn.classList.remove('show');
}

updateTrendDateRangeDisplay();
renderTrend('all', getActiveMetric(), formatDate(trendCalendarStart), formatDate(trendCalendarEnd));
