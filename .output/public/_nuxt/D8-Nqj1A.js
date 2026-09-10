import{g as w,s as $,K as V,a8 as U,o as N,x as k,y as D,p as o,w as G,a as t,t as y,d as T,B as l,C as d,c as z,q as _,J as v,H as E,_ as H}from"./B0X1sqPi.js";function m(r){return String(r??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}function u(r){const a=String(r??"").trim();return a?m(a):"&nbsp;"}function B(r){const a=String(r??"").trim();if(!a)return"";const s=new Date(a);return Number.isNaN(s.getTime())?a.replace("T"," "):s.toLocaleString("vi-VN",{hour12:!1})}function I(r){return[r.carrierName&&`Nhà xe: ${r.carrierName}`,r.carrierPhone&&`SĐT nhà xe: ${r.carrierPhone}`,r.driverName&&`Chủ xe/Tài xế: ${r.driverName}`,r.selectedProvinceName&&`Tỉnh vận chuyển: ${r.selectedProvinceName}`,r.carrierAddress&&`Địa chỉ nhà xe: ${r.carrierAddress}`,r.departureAt&&`Giờ xuất phát: ${B(r.departureAt)}`].filter(Boolean).join(" · ")}function L(r){return(r.length?r:[{}]).map((s,c)=>`
    <tr>
      <td class="center">${c+1}</td>
      <td>
        <strong>${u(s.productName)}</strong>
        ${s.productCode?`<div class="subtle">${m(s.productCode)}</div>`:""}
      </td>
      <td class="center package-cell">${u(s.packageCount)}</td>
      <td class="center logo-cell">${u(s.logo)}</td>
    </tr>
  `).join("")}function q(r){const a=r.type==="bus_carrier",s=I(r),c=a?`<div class="banner carrier-banner">TT Nhà xe: ${s?m(s):"&nbsp;"}</div>`:'<div class="banner warning">HÀNG DỄ VỠ VUI LÒNG NHẸ TAY</div>',g=a?'<div class="banner warning bottom-warning">HÀNG DỄ VỠ VUI LÒNG NHẸ TAY</div>':'<div class="banner post-office">Gửi Bưu Điện</div>';return`<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>${a?"Tem gửi nhà xe":"Tem gửi bưu điện"} - ${m(r.orderCode||"")}</title>
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
        <div class="party-body"><strong>${u(r.senderCode)}</strong>
${u(r.senderName)}
${u(r.senderPhone)}</div>
      </div>
      <div class="party">
        <div class="party-title">NGƯỜI NHẬN - TRẢ CƯỚC</div>
        <div class="party-body">
          <div class="receiver-line"><span>Người nhận:</span><strong>${u(r.receiverName)}</strong></div>
          <div class="receiver-line"><span>SĐT:</span><strong>${u(r.receiverPhone)}</strong></div>
          <div class="receiver-line"><span>Địa chỉ:</span><strong>${u(r.receiverAddress)}</strong></div>
          <div class="receiver-line"><span>Đơn hàng:</span><strong>${u(r.orderCode)}</strong></div>
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
      <tbody>${L(r.rows)}</tbody>
    </table>
    ${r.note?`<div class="note"><strong>Ghi chú:</strong> ${m(r.note)}</div>`:""}
    ${g}
  </section>
</body>
</html>`}const M={class:"label-summary"},R={class:"edit-section"},j={class:"form-grid three-columns"},O={class:"field"},F={class:"field"},K={class:"field"},Y={class:"edit-section"},J={class:"form-grid two-columns"},Q={class:"field"},W={class:"field"},X={class:"field full"},Z={class:"field full"},ee={key:0,class:"edit-section"},te={class:"form-grid three-columns"},ne={class:"field"},re={class:"field"},oe={class:"field"},ie={class:"field"},se={class:"field"},le={class:"field"},de={class:"edit-section"},ae={class:"table-wrap"},pe={class:"editable-table"},ue={class:"field note-field"},ce={class:"modal-actions"},me=["disabled"],ge="Đồ dùng một lần cho quán cà phê, trà sữa",ve="T019564009",he="CÔNG TY TNHH KINGCUP VIỆT NAM",be="039 5571728",xe=w({__name:"ParcelLabelPrintModal",props:{type:{},sourceCode:{},items:{},busTransport:{},request:{}},emits:["close"],setup(r,{emit:a}){const s=r,c=a,{showToast:g}=$(),h=v(()=>s.type==="bus_carrier"),C=v(()=>h.value?"In tem gửi nhà xe":"In tem gửi bưu điện"),b=V(s.request?.payload_json,{}),p=s.busTransport,n=U({senderCode:ve,senderName:he,senderPhone:be,receiverName:String(s.request?.receiver_name||b?.receiver_name||p?.receiver_name||s.request?.customer_name||"").trim(),receiverPhone:String(s.request?.receiver_phone||b?.receiver_phone||p?.receiver_phone||"").trim(),receiverAddress:String(s.request?.receiver_address||b?.receiver_address||p?.receiver_address||"").trim(),orderCode:String(s.request?.order_code||p?.order_code||s.sourceCode||"").trim(),productName:ge,packageCount:"",logo:"",carrierName:String(p?.carrier_name||"").trim(),carrierPhone:String(p?.carrier_phone||"").trim(),carrierAddress:String(p?.carrier_address||"").trim(),selectedProvinceName:String(p?.selected_province_name||"").trim(),driverName:String(p?.driver_name||"").trim(),departureAt:String(p?.departure_at||"").trim(),note:String(p?.note||"").trim()}),P=v(()=>[{productName:n.productName.trim(),productCode:"",packageCount:n.packageCount.trim(),logo:n.logo.trim()}]),x=v(()=>!!n.productName.trim());function A(){if(!x.value){g("Vui lòng nhập tên hàng hóa trước khi in.","error");return}const f=q({type:s.type,senderCode:n.senderCode,senderName:n.senderName,senderPhone:n.senderPhone,receiverName:n.receiverName,receiverPhone:n.receiverPhone,receiverAddress:n.receiverAddress,orderCode:n.orderCode,rows:P.value,carrierName:n.carrierName,carrierPhone:n.carrierPhone,carrierAddress:n.carrierAddress,selectedProvinceName:n.selectedProvinceName,driverName:n.driverName,departureAt:n.departureAt,note:n.note});E(f,()=>g("Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up cho trang này.","error"))}return(f,e)=>{const S=D;return N(),k(S,{title:o(C),size:"xl","show-footer":!1,onClose:e[18]||(e[18]=i=>c("close"))},{default:G(()=>[t("div",M,[t("div",null,[e[19]||(e[19]=t("label",null,"Mã yêu cầu/Phiếu",-1)),t("strong",null,y(r.sourceCode),1)]),t("div",null,[e[20]||(e[20]=t("label",null,"Loại phiếu",-1)),t("strong",null,y(o(h)?"Gửi nhà xe":"Gửi bưu điện"),1)]),e[21]||(e[21]=t("div",null,[t("label",null,"Dòng hàng hóa"),t("strong",null,"1 dòng cố định")],-1))]),e[42]||(e[42]=t("div",{class:"edit-hint"},[T("Có thể chỉnh sửa các nội dung dưới đây trước khi bấm "),t("strong",null,"In phiếu"),T(".")],-1)),t("section",R,[e[25]||(e[25]=t("h3",null,"Thông tin người gửi",-1)),t("div",j,[t("label",O,[e[22]||(e[22]=t("span",null,"Mã người gửi",-1)),l(t("input",{"onUpdate:modelValue":e[0]||(e[0]=i=>o(n).senderCode=i),type:"text"},null,512),[[d,o(n).senderCode]])]),t("label",F,[e[23]||(e[23]=t("span",null,"Tên người gửi",-1)),l(t("input",{"onUpdate:modelValue":e[1]||(e[1]=i=>o(n).senderName=i),type:"text"},null,512),[[d,o(n).senderName]])]),t("label",K,[e[24]||(e[24]=t("span",null,"Số điện thoại",-1)),l(t("input",{"onUpdate:modelValue":e[2]||(e[2]=i=>o(n).senderPhone=i),type:"text"},null,512),[[d,o(n).senderPhone]])])])]),t("section",Y,[e[30]||(e[30]=t("h3",null,"Thông tin người nhận",-1)),t("div",J,[t("label",Q,[e[26]||(e[26]=t("span",null,"Người nhận",-1)),l(t("input",{"onUpdate:modelValue":e[3]||(e[3]=i=>o(n).receiverName=i),type:"text"},null,512),[[d,o(n).receiverName]])]),t("label",W,[e[27]||(e[27]=t("span",null,"Số điện thoại",-1)),l(t("input",{"onUpdate:modelValue":e[4]||(e[4]=i=>o(n).receiverPhone=i),type:"text"},null,512),[[d,o(n).receiverPhone]])]),t("label",X,[e[28]||(e[28]=t("span",null,"Địa chỉ nhận",-1)),l(t("textarea",{"onUpdate:modelValue":e[5]||(e[5]=i=>o(n).receiverAddress=i),rows:"2"},null,512),[[d,o(n).receiverAddress]])]),t("label",Z,[e[29]||(e[29]=t("span",null,"Mã đơn hàng",-1)),l(t("input",{"onUpdate:modelValue":e[6]||(e[6]=i=>o(n).orderCode=i),type:"text"},null,512),[[d,o(n).orderCode]])])])]),o(h)?(N(),z("section",ee,[e[37]||(e[37]=t("h3",null,"Thông tin nhà xe",-1)),t("div",te,[t("label",ne,[e[31]||(e[31]=t("span",null,"Tên nhà xe",-1)),l(t("input",{"onUpdate:modelValue":e[7]||(e[7]=i=>o(n).carrierName=i),type:"text"},null,512),[[d,o(n).carrierName]])]),t("label",re,[e[32]||(e[32]=t("span",null,"SĐT nhà xe",-1)),l(t("input",{"onUpdate:modelValue":e[8]||(e[8]=i=>o(n).carrierPhone=i),type:"text"},null,512),[[d,o(n).carrierPhone]])]),t("label",oe,[e[33]||(e[33]=t("span",null,"Chủ xe/Tài xế",-1)),l(t("input",{"onUpdate:modelValue":e[9]||(e[9]=i=>o(n).driverName=i),type:"text"},null,512),[[d,o(n).driverName]])]),t("label",ie,[e[34]||(e[34]=t("span",null,"Tỉnh vận chuyển",-1)),l(t("input",{"onUpdate:modelValue":e[10]||(e[10]=i=>o(n).selectedProvinceName=i),type:"text"},null,512),[[d,o(n).selectedProvinceName]])]),t("label",se,[e[35]||(e[35]=t("span",null,"Giờ xuất phát",-1)),l(t("input",{"onUpdate:modelValue":e[11]||(e[11]=i=>o(n).departureAt=i),type:"text"},null,512),[[d,o(n).departureAt]])]),t("label",le,[e[36]||(e[36]=t("span",null,"Địa chỉ nhà xe",-1)),l(t("input",{"onUpdate:modelValue":e[12]||(e[12]=i=>o(n).carrierAddress=i),type:"text"},null,512),[[d,o(n).carrierAddress]])])])])):_("",!0),t("section",de,[e[41]||(e[41]=t("h3",null,"Nội dung hàng hóa trên tem",-1)),t("div",ae,[t("table",pe,[e[39]||(e[39]=t("thead",null,[t("tr",null,[t("th",null,"STT"),t("th",null,"Tên hàng hóa"),t("th",null,"Số kiện"),t("th",null,"Logo")])],-1)),t("tbody",null,[t("tr",null,[e[38]||(e[38]=t("td",{class:"center"},"1",-1)),t("td",null,[l(t("textarea",{"onUpdate:modelValue":e[13]||(e[13]=i=>o(n).productName=i),rows:"2","aria-label":"Tên hàng hóa"},null,512),[[d,o(n).productName]])]),t("td",null,[l(t("input",{"onUpdate:modelValue":e[14]||(e[14]=i=>o(n).packageCount=i),type:"text","aria-label":"Số kiện",placeholder:"Để trống"},null,512),[[d,o(n).packageCount]])]),t("td",null,[l(t("input",{"onUpdate:modelValue":e[15]||(e[15]=i=>o(n).logo=i),type:"text","aria-label":"Logo",placeholder:"Để trống"},null,512),[[d,o(n).logo]])])])])])]),t("label",ue,[e[40]||(e[40]=t("span",null,"Ghi chú trên tem",-1)),l(t("textarea",{"onUpdate:modelValue":e[16]||(e[16]=i=>o(n).note=i),rows:"2",placeholder:"Không bắt buộc"},null,512),[[d,o(n).note]])])]),t("div",ce,[t("button",{type:"button",class:"btn",onClick:e[17]||(e[17]=i=>c("close"))},"Đóng"),t("button",{type:"button",class:"btn primary",disabled:!o(x),onClick:A},"In phiếu",8,me)])]),_:1},8,["title"])}}}),Ne=H(xe,[["__scopeId","data-v-30f5c729"]]);export{Ne as _};
