function escapePdf(value) {
    return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function text(x, y, size, value) {
    return `BT /F1 ${size} Tf ${x} ${y} Td (${escapePdf(value)}) Tj ET`;
}
function pageStream(warehouse, rows, page, pageCount, blank) {
    const commands = [
        text(42, 800, 18, "STOCKFLOW - PHYSICAL STOCK COUNT SHEET"),
        text(42, 778, 11, `Warehouse: ${warehouse.code} - ${warehouse.name}`),
        text(42, 762, 9, `Address: ${warehouse.address ?? "-"}`),
        text(490, 778, 8, `Page ${page}/${pageCount}`),
        text(42, 742, 9, "Count date: ____________________    Counter: ____________________"),
        "0.80 G 42 727 m 553 727 l S",
        text(45, 710, 8, "SKU"), text(125, 710, 8, "PRODUCT"), text(350, 710, 8, "SYSTEM"),
        text(405, 710, 8, "PHYSICAL"), text(470, 710, 8, "VARIANCE"), text(530, 710, 8, "UNIT"),
    ];
    rows.forEach((row, index) => {
        const y = 690 - index * 20;
        commands.push("0.90 G 42 " + (y - 5) + " m 553 " + (y - 5) + " l S");
        commands.push(text(45, y, 7, row.sku.slice(0, 15)));
        commands.push(text(125, y, 7, row.name.slice(0, 38)));
        commands.push(text(360, y, 7, blank ? "" : String(row.systemQuantity)));
        commands.push(text(420, y, 7, "________"));
        commands.push(text(480, y, 7, "________"));
        commands.push(text(532, y, 7, row.unit.slice(0, 7)));
    });
    commands.push(text(42, 66, 8, "Notes: ______________________________________________________________________________"));
    commands.push(text(42, 42, 8, "Approved by: ____________________    Signature: ____________________"));
    return commands.join("\n");
}
export function createStockCountSheetPdf(warehouse, rows) {
    const blankRows = Array.from({ length: 18 }, () => ({ sku: "", name: "", systemQuantity: 0, unit: "" }));
    const source = rows.length > 0 ? rows : blankRows;
    const pages = Array.from({ length: Math.ceil(source.length / 30) }, (_, index) => source.slice(index * 30, (index + 1) * 30));
    const pageIds = pages.map((_, index) => 4 + index * 2);
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    pages.forEach((pageRows, index) => {
        const pageId = 4 + index * 2;
        const contentId = pageId + 1;
        const stream = pageStream(warehouse, pageRows, index + 1, pages.length, rows.length === 0);
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
        objects.push(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    });
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(pdf, "utf8"));
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(pdf, "utf8");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index <= objects.length; index += 1)
        pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, "utf8");
}
