const COMMERCIAL_PRINT_ALIGNMENT = `
  <style>
    /* Giữ nguyên mẫu in hiện tại, chỉ căn hai vùng theo phiếu gốc. */
    .header .company {
      position: relative;
      left: 26mm;
    }

    .bank-info strong {
      width: 95mm;
      text-align: center;
    }
  </style>
`

export function applyCommercialPrintAlignment(html: string) {
  return html.replace('</head>', `${COMMERCIAL_PRINT_ALIGNMENT}</head>`)
}
