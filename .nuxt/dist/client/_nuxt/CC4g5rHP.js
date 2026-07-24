import{g as z,s as P,o as g,x as G,y as k,p as l,w as H,a as e,t as i,c as h,q as w,z as B,F as A,a3 as a,H as I,aj as q,_ as L}from"./CXgtbY2V.js";function m(t){return String(t??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}function p(t){const s=String(t??"").trim();return s?m(s):"&nbsp;"}function V(t){const s=String(t??"").trim();if(!s)return"";const n=new Date(s);return Number.isNaN(n.getTime())?s.replace("T"," "):n.toLocaleString("vi-VN",{hour12:!1})}function j(t){return[t.carrierName&&`Nhà xe: ${t.carrierName}`,t.carrierPhone&&`SĐT nhà xe: ${t.carrierPhone}`,t.vehiclePlate&&`Biển số: ${t.vehiclePlate}`,t.driverName&&`Chủ xe/Tài xế: ${t.driverName}`,t.departureAt&&`Giờ xuất phát: ${V(t.departureAt)}`].filter(Boolean).join(" · ")}function D(t){return(t.length?t:[{}]).map((n,c)=>`
    <tr>
      <td class="center">${c+1}</td>
      <td>
        <strong>${p(n.productName)}</strong>
        ${n.productCode?`<div class="subtle">${m(n.productCode)}</div>`:""}
      </td>
      <td class="center package-cell">&nbsp;</td>
      <td class="center logo-cell">${p(n.logo)}</td>
    </tr>
  `).join("")}function M(t){const s=t.type==="bus_carrier",n=j(t),c=s?`<div class="banner carrier-banner">TT Nhà xe: ${n?m(n):"&nbsp;"}</div>`:'<div class="banner warning">HÀNG DỄ VỠ VUI LÒNG NHẸ TAY</div>',v=s?'<div class="banner warning bottom-warning">HÀNG DỄ VỠ VUI LÒNG NHẸ TAY</div>':'<div class="banner post-office">Gửi Bưu Điện</div>';return`<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>${s?"Tem gửi nhà xe":"Tem gửi bưu điện"} - ${m(t.orderCode||"")}</title>
  <style>
    * { box-sizing: border-box; }
    @page { size: A4 landscape; margin: 8mm; }
    body { margin: 0; color: #000; background: #fff; font-family: Arial, Helvetica, sans-serif; }
    .sheet { width: 100%; border: 2px solid #000; }
    .banner { min-height: 66px; display: flex; align-items: center; justify-content: center; padding: 10px 14px; border-bottom: 2px solid #000; text-align: center; font-weight: 800; font-size: 28px; line-height: 1.15; }
    .carrier-banner { font-size: 23px; }
    .sender-receiver { display: grid; grid-template-columns: 1fr 1.7fr; }
    .party { border-bottom: 2px solid #000; }
    .party + .party { border-left: 2px solid #000; }
    .party-title { padding: 8px; border-bottom: 2px solid #000; text-align: center; font-size: 18px; font-weight: 800; }
    .party-body { min-height: 132px; padding: 14px 16px; font-size: 18px; line-height: 1.45; white-space: pre-line; }
    .party-body strong { font-size: 20px; }
    .receiver-line { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 8px; margin-bottom: 7px; }
    .receiver-line span:first-child { font-weight: 700; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border-right: 2px solid #000; border-bottom: 2px solid #000; padding: 9px 10px; vertical-align: middle; font-size: 17px; }
    th:last-child, td:last-child { border-right: 0; }
    th { text-align: center; font-size: 16px; }
    tbody td { min-height: 62px; }
    .col-stt { width: 8%; }
    .col-name { width: 56%; }
    .col-package { width: 15%; }
    .col-logo { width: 21%; }
    .center { text-align: center; }
    .package-cell { min-height: 62px; }
    .logo-cell { font-size: 20px; font-weight: 800; white-space: pre-line; }
    .subtle { margin-top: 4px; font-size: 13px; font-weight: 400; }
    .note { padding: 8px 12px; border-bottom: 2px solid #000; font-size: 14px; }
    .post-office { border-bottom: 0; font-size: 30px; }
    .bottom-warning { border-bottom: 0; font-size: 28px; }
    @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
  <section class="sheet">
    ${c}
    <div class="sender-receiver">
      <div class="party">
        <div class="party-title">NGƯỜI GỬI</div>
        <div class="party-body"><strong>T019564009</strong>
CÔNG TY TNHH KINGCUP VIỆT NAM
039 5571728</div>
      </div>
      <div class="party">
        <div class="party-title">NGƯỜI NHẬN - TRẢ CƯỚC</div>
        <div class="party-body">
          <div class="receiver-line"><span>Người nhận:</span><strong>${p(t.receiverName)}</strong></div>
          <div class="receiver-line"><span>SĐT:</span><strong>${p(t.receiverPhone)}</strong></div>
          <div class="receiver-line"><span>Địa chỉ:</span><strong>${p(t.receiverAddress)}</strong></div>
          <div class="receiver-line"><span>Đơn hàng:</span><strong>${p(t.orderCode)}</strong></div>
        </div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th class="col-stt">STT</th>
          <th class="col-name">TÊN HÀNG HÓA</th>
          <th class="col-package">SỐ KIỆN</th>
          <th class="col-logo">LOGO</th>
        </tr>
      </thead>
      <tbody>${D(t.rows)}</tbody>
    </table>
    ${t.note?`<div class="note"><strong>Ghi chú:</strong> ${m(t.note)}</div>`:""}
    ${v}
  </section>
  <script>window.addEventListener('load', () => { window.focus(); setTimeout(() => window.print(), 250); });<\/script>
</body>
</html>`}const U={class:"label-summary"},Y={class:"receiver-box"},R={class:"full"},E={key:0,class:"carrier-box"},F={class:"small subtle"},K={class:"table-wrap",style:{"margin-top":"14px"}},O={style:{"min-width":"720px"}},J={class:"small subtle"},Q={key:0},W={class:"modal-actions"},X=["disabled"],Z=z({__name:"ParcelLabelPrintModal",props:{type:{},sourceCode:{},items:{},busTransport:{},request:{}},emits:["close"],setup(t,{emit:s}){const n=t,c=s,{showToast:v}=P(),b=a(()=>n.type==="bus_carrier"),$=a(()=>b.value?"In tem gửi nhà xe":"In tem gửi bưu điện"),x=a(()=>q(n.request?.payload_json,{})),f=a(()=>String(n.request?.receiver_name||x.value?.receiver_name||n.busTransport?.receiver_name||n.request?.customer_name||"").trim()),y=a(()=>String(n.request?.receiver_phone||x.value?.receiver_phone||n.busTransport?.receiver_phone||"").trim()),N=a(()=>String(n.request?.receiver_address||x.value?.receiver_address||n.busTransport?.receiver_address||"").trim()),T=a(()=>String(n.request?.order_code||n.busTransport?.order_code||n.sourceCode||"").trim()),u=a(()=>n.items.filter(o=>o&&o.deleted!==!0&&o.active!==!1).map(o=>({productName:o.product_name||"",productCode:o.product_code||"",logo:o.logo||o.target_logo||o.source_logo||""})));function C(){const o=n.busTransport,r=M({type:n.type,receiverName:f.value,receiverPhone:y.value,receiverAddress:N.value,orderCode:T.value,rows:u.value,carrierName:o?.carrier_name||"",carrierPhone:o?.carrier_phone||"",vehiclePlate:o?.vehicle_plate||"",driverName:o?.driver_name||"",departureAt:o?.departure_at||"",note:o?.note||""});I(r,()=>v("Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up cho trang này.","error"))}return(o,r)=>{const S=k;return g(),G(S,{title:l($),size:"xl","show-footer":!1,onClose:r[1]||(r[1]=d=>c("close"))},{default:H(()=>[e("div",U,[e("div",null,[r[2]||(r[2]=e("label",null,"Mã yêu cầu/Phiếu",-1)),e("strong",null,i(t.sourceCode),1)]),e("div",null,[r[3]||(r[3]=e("label",null,"Loại phiếu",-1)),e("strong",null,i(l(b)?"Gửi nhà xe":"Gửi bưu điện"),1)]),e("div",null,[r[4]||(r[4]=e("label",null,"Đơn hàng",-1)),e("strong",null,i(l(T)||"-"),1)]),e("div",null,[r[5]||(r[5]=e("label",null,"Sản phẩm",-1)),e("strong",null,i(l(u).length)+" dòng",1)])]),e("div",Y,[e("div",null,[r[6]||(r[6]=e("label",null,"Người nhận",-1)),e("strong",null,i(l(f)||"-"),1)]),e("div",null,[r[7]||(r[7]=e("label",null,"Số điện thoại",-1)),e("strong",null,i(l(y)||"-"),1)]),e("div",R,[r[8]||(r[8]=e("label",null,"Địa chỉ nhận",-1)),e("strong",null,i(l(N)||"-"),1)])]),l(b)?(g(),h("div",E,[r[9]||(r[9]=e("strong",null,"Thông tin nhà xe",-1)),e("div",null,i(t.busTransport?.carrier_name||"Chưa nhập tên nhà xe"),1),e("div",F,i([t.busTransport?.carrier_phone,t.busTransport?.vehicle_plate,t.busTransport?.driver_name].filter(Boolean).join(" · ")||"Chưa có SĐT, biển số hoặc tên chủ xe/tài xế"),1)])):w("",!0),e("div",K,[e("table",O,[r[12]||(r[12]=e("thead",null,[e("tr",null,[e("th",null,"STT"),e("th",null,"Tên hàng hóa"),e("th",null,"Số kiện"),e("th",null,"Logo")])],-1)),e("tbody",null,[(g(!0),h(A,null,B(l(u),(d,_)=>(g(),h("tr",{key:`${d.productCode}|${d.logo}|${_}`},[e("td",null,i(_+1),1),e("td",null,[e("b",null,i(d.productName||"-"),1),e("div",J,i(d.productCode||""),1)]),r[10]||(r[10]=e("td",null,null,-1)),e("td",null,i(d.logo||"-"),1)]))),128)),l(u).length?w("",!0):(g(),h("tr",Q,[...r[11]||(r[11]=[e("td",{colspan:"4",class:"empty"},"Yêu cầu chưa có sản phẩm để in.",-1)])]))])])]),e("div",W,[e("button",{type:"button",class:"btn",onClick:r[0]||(r[0]=d=>c("close"))},"Đóng"),e("button",{type:"button",class:"btn primary",disabled:!l(u).length,onClick:C},"In phiếu",8,X)])]),_:1},8,["title"])}}}),te=L(Z,[["__scopeId","data-v-1cd0cfaa"]]);export{te as _};
