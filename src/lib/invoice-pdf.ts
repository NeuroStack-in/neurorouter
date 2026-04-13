import jsPDF from "jspdf"

interface InvoiceData {
    invoiceNumber: string
    yearMonth: string
    status: string
    dueDate?: string
    inputTokens: number
    outputTokens: number
    fixedFeeInr: number
    variableCostUsd: number
    totalDisplay: string
    userName?: string
    userEmail?: string
}

export function generateInvoicePDF(inv: InvoiceData) {
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    let y = 20

    // Header
    doc.setFontSize(22)
    doc.setFont("helvetica", "bold")
    doc.text("NEUROROUTER", 20, y)
    doc.setFontSize(10)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(100)
    doc.text("AI-Powered Development Platform", 20, y + 7)
    doc.setTextColor(0)

    // Invoice badge
    doc.setFontSize(28)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(50, 50, 150)
    doc.text("INVOICE", pageWidth - 20, y, { align: "right" })
    doc.setTextColor(0)

    y += 25

    // Line separator
    doc.setDrawColor(200)
    doc.setLineWidth(0.5)
    doc.line(20, y, pageWidth - 20, y)
    y += 12

    // Invoice details (left) and status (right)
    doc.setFontSize(10)
    doc.setFont("helvetica", "bold")
    doc.text("Invoice Number:", 20, y)
    doc.setFont("helvetica", "normal")
    doc.text(inv.invoiceNumber, 70, y)

    // Status badge on the right
    const statusColors: Record<string, [number, number, number]> = {
        PAID: [34, 139, 34],
        PENDING: [200, 150, 0],
        OVERDUE: [200, 50, 50],
    }
    const [r, g, b] = statusColors[inv.status] || [100, 100, 100]
    doc.setTextColor(r, g, b)
    doc.setFont("helvetica", "bold")
    doc.text(inv.status, pageWidth - 20, y, { align: "right" })
    doc.setTextColor(0)

    y += 7
    doc.setFont("helvetica", "bold")
    doc.text("Billing Period:", 20, y)
    doc.setFont("helvetica", "normal")
    doc.text(inv.yearMonth, 70, y)

    y += 7
    if (inv.dueDate) {
        doc.setFont("helvetica", "bold")
        doc.text("Due Date:", 20, y)
        doc.setFont("helvetica", "normal")
        doc.text(inv.dueDate.split("T")[0], 70, y)
        y += 7
    }

    if (inv.userName || inv.userEmail) {
        doc.setFont("helvetica", "bold")
        doc.text("Billed To:", 20, y)
        doc.setFont("helvetica", "normal")
        doc.text(inv.userName || inv.userEmail || "", 70, y)
        y += 7
    }

    y += 8

    // Usage table header
    doc.setFillColor(245, 245, 250)
    doc.rect(20, y - 5, pageWidth - 40, 10, "F")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.text("Description", 25, y + 1)
    doc.text("Quantity", 110, y + 1)
    doc.text("Amount", pageWidth - 25, y + 1, { align: "right" })
    y += 12

    // Usage rows
    doc.setFont("helvetica", "normal")
    const FREE_TIER = 1_000_000

    // Input tokens
    doc.text("Input Tokens", 25, y)
    doc.text(inv.inputTokens.toLocaleString(), 110, y)
    const inputOverage = Math.max(0, inv.inputTokens - FREE_TIER)
    const inputCost = (inputOverage / 1_000_000) * 2
    doc.text(inputOverage > 0 ? `$${inputCost.toFixed(2)}` : "Free tier", pageWidth - 25, y, { align: "right" })
    y += 7

    // Output tokens
    doc.text("Output Tokens", 25, y)
    doc.text(inv.outputTokens.toLocaleString(), 110, y)
    const outputOverage = Math.max(0, inv.outputTokens - FREE_TIER)
    const outputCost = (outputOverage / 1_000_000) * 8
    doc.text(outputOverage > 0 ? `$${outputCost.toFixed(2)}` : "Free tier", pageWidth - 25, y, { align: "right" })
    y += 7

    // Free tier note
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.text("Free tier: 1,000,000 input + 1,000,000 output tokens/month", 25, y)
    doc.text("Overage: $2/1M input, $8/1M output", 25, y + 4)
    doc.setTextColor(0)
    doc.setFontSize(10)
    y += 14

    // Separator
    doc.setDrawColor(200)
    doc.line(20, y, pageWidth - 20, y)
    y += 10

    // Totals
    doc.setFont("helvetica", "normal")
    doc.text("Fixed Fee (Monthly)", 25, y)
    doc.text(`₹${inv.fixedFeeInr.toLocaleString()}`, pageWidth - 25, y, { align: "right" })
    y += 7

    doc.text("Variable Cost (Token Overage)", 25, y)
    doc.text(`$${inv.variableCostUsd.toFixed(2)}`, pageWidth - 25, y, { align: "right" })
    y += 10

    // Total line
    doc.setDrawColor(50, 50, 150)
    doc.setLineWidth(1)
    doc.line(100, y, pageWidth - 20, y)
    y += 8

    doc.setFontSize(13)
    doc.setFont("helvetica", "bold")
    doc.text("Total Due:", 100, y)
    doc.text(inv.totalDisplay || `₹${inv.fixedFeeInr} + $${inv.variableCostUsd.toFixed(2)}`, pageWidth - 25, y, { align: "right" })

    // Footer
    y = doc.internal.pageSize.getHeight() - 25
    doc.setDrawColor(200)
    doc.setLineWidth(0.3)
    doc.line(20, y, pageWidth - 20, y)
    y += 6
    doc.setFontSize(8)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(130)
    doc.text("NeuroRouter — AI-Powered Development Platform", 20, y)
    doc.text("Generated on: " + new Date().toISOString().split("T")[0], pageWidth - 20, y, { align: "right" })

    // Save
    doc.save(`${inv.invoiceNumber || "invoice"}.pdf`)
}
