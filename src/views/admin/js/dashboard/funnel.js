// Funnel Chart
var funnelBrandId = '';

var F = function(){ return $('funnelContainer'); };
function renderFunnel(brandId) {
  funnelBrandId = brandId;
  var name = $('funnelBrandFilter') ? $('funnelBrandFilter').querySelector('.custom-select-label').textContent : '';
  if (F()) {
    F().innerHTML = '<div class="funnel-grid"><div class="funnel-brand">'+
      '<div class="funnel-name">'+escapeHtml(name)+'</div>'+
      '<div class="funnel-bars">'+
        '<div class="funnel-row"><span class="funnel-label">Lượt xem</span><div class="funnel-track"><div class="funnel-bar funnel-bar-skeleton" style="width:85%"></div></div><span class="funnel-val skeleton" style="display:inline-block;width:80px;height:18px;border-radius:4px;"></span></div>'+
        '<div class="funnel-row"><span class="funnel-label">Thêm giỏ hàng</span><div class="funnel-track"><div class="funnel-bar funnel-bar-skeleton" style="width:55%"></div></div><span class="funnel-val skeleton" style="display:inline-block;width:80px;height:18px;border-radius:4px;"></span></div>'+
        '<div class="funnel-row"><span class="funnel-label">Thanh toán</span><div class="funnel-track"><div class="funnel-bar funnel-bar-skeleton" style="width:30%"></div></div><span class="funnel-val skeleton" style="display:inline-block;width:80px;height:18px;border-radius:4px;"></span></div>'+
        '<div class="funnel-row"><span class="funnel-label">Mua hàng</span><div class="funnel-track"><div class="funnel-bar funnel-bar-skeleton" style="width:15%"></div></div><span class="funnel-val skeleton" style="display:inline-block;width:80px;height:18px;border-radius:4px;"></span></div>'+
      '</div></div></div>';
  }
  var url = '/api/funnel/data';
  if (brandId) url += '?brandId=' + encodeURIComponent(brandId);
  fetch(url, { headers: H }).then(function(r){return r.json();}).then(function(res){
    if (!F()) return;
    if (!res.success) { F().innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px;font-size:13px;">Lỗi tải dữ liệu</p>'; return; }
    if (!res.data || !res.data.length) {
      F().innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px;font-size:13px;">Chưa có dữ liệu chuyển đổi</p>';
      return;
    }
    var html = '<div class="funnel-grid">';
    res.data.forEach(function(brand){
      var s = brand.stages;
      var maxVal = Math.max(s.views, 1);
      var pct = function(v){ return Math.max(2, (v/maxVal)*100); };
      var cv1 = s.views ? ((s.addToCart/s.views)*100).toFixed(0) : 0;
      var cv2 = s.addToCart ? ((s.checkout/s.addToCart)*100).toFixed(0) : 0;
      var cv3 = s.checkout ? ((s.purchases/s.checkout)*100).toFixed(0) : 0;
      html += '<div class="funnel-brand">'+
        '<div class="funnel-name">'+escapeHtml(brand.brandName)+'</div>'+
        '<div class="funnel-bars">'+
          '<div class="funnel-row"><span class="funnel-label">Lượt xem</span><div class="funnel-track"><div class="funnel-bar funnel-bar-views" style="width:'+pct(s.views)+'%"></div></div><span class="funnel-val">'+fmt(s.views)+'</span></div>'+
          '<div class="funnel-row"><span class="funnel-label">Thêm giỏ hàng</span><div class="funnel-track"><div class="funnel-bar funnel-bar-cart" style="width:'+pct(s.addToCart)+'%"></div></div><span class="funnel-val">'+fmt(s.addToCart)+' <span class="funnel-cv">'+cv1+'%</span></span></div>'+
          '<div class="funnel-row"><span class="funnel-label">Thanh toán</span><div class="funnel-track"><div class="funnel-bar funnel-bar-checkout" style="width:'+pct(s.checkout)+'%"></div></div><span class="funnel-val">'+fmt(s.checkout)+' <span class="funnel-cv">'+cv2+'%</span></span></div>'+
          '<div class="funnel-row"><span class="funnel-label">Mua hàng</span><div class="funnel-track"><div class="funnel-bar funnel-bar-purchase" style="width:'+pct(s.purchases)+'%"></div></div><span class="funnel-val">'+fmt(s.purchases)+' <span class="funnel-cv">'+cv3+'%</span></span></div>'+
        '</div></div>';
    });
    html += '</div>';
    F().innerHTML = html;
  }).catch(function(){
    if (F()) F().innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px;font-size:13px;">Lỗi tải dữ liệu</p>';
  });
}
initCustomSelect('funnelBrandFilter', function(id, name){ renderFunnel(id); }, true);
