var API_TOKEN = window.__API_TOKEN__ || '';
var H = { 'Authorization': 'Bearer ' + API_TOKEN };

function $(id) { return document.getElementById(id); }
function fmt(n) { return (n || 0).toLocaleString('vi-VN'); }
function fmtCurrency(n) { return fmt(n) + 'đ'; }
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]||m; });
}

var statusLabel = { pending: 'CHỜ THANH TOÁN', processing: 'VẬN CHUYỂN', shipped: 'CHỜ GIAO HÀNG', delivered: 'HOÀN THÀNH', cancelled: 'ĐÃ HỦY' };
var statusColor = { pending: 'status-warning', processing: 'status-processing', shipped: 'status-primary', delivered: 'status-success', cancelled: 'status-error' };

function formatDate(d) {
  var month = '' + (d.getMonth() + 1),
      day = '' + d.getDate(),
      year = d.getFullYear();
  if (month.length < 2) month = '0' + month;
  if (day.length < 2) day = '0' + day;
  return [year, month, day].join('-');
}

function formatDisplayDate(d) {
  var month = '' + (d.getMonth() + 1),
      day = '' + d.getDate();
  if (month.length < 2) month = '0' + month;
  if (day.length < 2) day = '0' + day;
  return day + '/' + month + '/' + d.getFullYear();
}

function getWeekRange(date) {
  var d = new Date(date);
  var day = d.getDay();
  var diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  var monday = new Date(d.getFullYear(), d.getMonth(), diffToMonday);
  monday.setHours(0,0,0,0);
  
  var sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23,59,59,999);
  return { monday: monday, sunday: sunday };
}

// Custom Select Dropdown Initializer
function initCustomSelect(selectId, onSelect, selectFirst) {
  var S = $(selectId);
  if (!S) return;
  var itemsWrap = S.querySelector('.custom-select-items');
  var label = S.querySelector('.custom-select-label');
  var searchInput = S.querySelector('.custom-select-search');
  var trigger = S.querySelector('.custom-select-trigger');

  trigger.addEventListener('click', function(e){
    e.stopPropagation();
    S.classList.toggle('open');
  });

  function populateDropdown() {
    if (!window.allBrands || !window.allBrands.length) {
      fetch('/api/funnel/data', { headers: H }).then(function(r){return r.json();}).then(function(res){
        if (res.success && res.brands && res.brands.length) {
          window.allBrands = res.brands;
          renderItems(window.allBrands);
          if (selectFirst) selectFirstBrand();
        }
      });
      return;
    }
    renderItems(window.allBrands);
    if (selectFirst) selectFirstBrand();
  }

  function renderItems(brands) {
    itemsWrap.innerHTML = '';
    brands.forEach(function(b){
      var item = document.createElement('div');
      item.className = 'custom-select-item';
      item.dataset.value = b.brandId;
      item.textContent = b.brandName;
      item.addEventListener('click', function(e){
        e.stopPropagation();
        selectItem(b.brandId, b.brandName);
      });
      itemsWrap.appendChild(item);
    });
  }

  function selectItem(id, name) {
    label.textContent = name;
    itemsWrap.querySelectorAll('.custom-select-item').forEach(function(el){ el.classList.remove('active'); });
    var active = itemsWrap.querySelector('.custom-select-item[data-value="'+id+'"]');
    if (active) active.classList.add('active');
    S.classList.remove('open');
    if (searchInput) searchInput.value = '';
    onSelect(id, name);
  }

  function selectFirstBrand() {
    if (!window.allBrands || !window.allBrands.length) return;
    var first = window.allBrands[0];
    selectItem(first.brandId, first.brandName);
  }

  if (searchInput) {
    searchInput.addEventListener('input', function(){
      var q = this.value.toLowerCase().trim();
      itemsWrap.querySelectorAll('.custom-select-item').forEach(function(el){
        el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? '' : 'none';
      });
    });
    searchInput.addEventListener('click', function(e){ e.stopPropagation(); });
  }

  S.addEventListener('click', function(e){ e.stopPropagation(); });
  populateDropdown();
}

document.addEventListener('click', function(){
  document.querySelectorAll('.custom-select.open').forEach(function(el){ el.classList.remove('open'); });
});
