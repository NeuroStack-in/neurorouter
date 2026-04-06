"use client";

import { useEffect, useState } from "react";
import {
    CreditCard,
    AlertTriangle,
    CheckCircle,
    FileText,
    Activity,
    ShieldAlert
} from "lucide-react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import styles from "./billing.module.css";
import { generateInvoicePDF } from "@/lib/invoice-pdf";

// --- Types ---

interface CurrentUsage {
    user_id: string;
    year_month: string;
    input_tokens: number;
    output_tokens: number;
    estimated_variable_usd: number;
    fixed_fee_inr: number;
    total_display: string;
}

interface BillingCycle {
    id: string;
    invoice_number: string;
    year_month: string;
    status: "PENDING" | "PAID" | "OVERDUE" | "VOID";
    due_date: string;
    grace_period_end: string;
    total_input_tokens?: number;
    total_output_tokens?: number;
    fixed_fee_inr?: number;
    variable_cost_usd?: number;
    total_due_display: string;
    // Legacy nested shape fallback
    calculated_costs?: {
        total_due_display: string;
    };
}

interface CurrentPlan {
    planId: string;
    name: string;
    monthlyFee: number;
    currency: string;
}

interface GraceBanner {
    show: boolean;
    daysRemaining: number;
    billingMessage: string;
}

interface BillingDashboardData {
    current_month: CurrentUsage;
    current_plan?: CurrentPlan;
    past_invoices: BillingCycle[];
    account_status: "ACTIVE" | "GRACE" | "BLOCKED" | "PENDING_APPROVAL";
    graceBanner: GraceBanner;
}

// --- Component ---

export default function BillingPage() {
    const [data, setData] = useState<BillingDashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedInvoice, setSelectedInvoice] = useState<BillingCycle | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);

    const handleDownloadPDF = async (invoiceId: string) => {
        setDownloading(invoiceId);
        const inv = data?.past_invoices.find(i => i.id === invoiceId);
        if (inv) {
            generateInvoicePDF({
                invoiceNumber: inv.invoice_number,
                yearMonth: inv.year_month,
                status: inv.status,
                dueDate: inv.due_date,
                inputTokens: inv.total_input_tokens || 0,
                outputTokens: inv.total_output_tokens || 0,
                fixedFeeInr: inv.fixed_fee_inr || 1599,
                variableCostUsd: inv.variable_cost_usd || 0,
                totalDisplay: getInvoiceTotal(inv),
            });
        }
        setDownloading(null);
    };

    const getInvoiceTotal = (inv: BillingCycle) => {
        return inv.total_due_display || inv.calculated_costs?.total_due_display || "N/A";
    };

    useEffect(() => {
        fetchBillingData();
    }, []);

    const fetchBillingData = async () => {
        try {
            const token = localStorage.getItem("jwt");
            if (!token) throw new Error("Not authenticated");

            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/billing/me`, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });

            if (!res.ok) throw new Error("Failed to load billing data");

            const jsonData = await res.json();
            setData(jsonData);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const getStatusBadgeVar = (status: string) => {
        switch (status) {
            case "PAID": return "default"; // or success if available, default is usually black/primary
            case "PENDING": return "secondary";
            case "OVERDUE": return "destructive";
            default: return "outline";
        }
    };

    if (loading) {
        return (
            <div className="p-8 space-y-4 animate-pulse">
                <div className="h-12 bg-gray-200 rounded w-1/3"></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="h-64 bg-gray-200 rounded"></div>
                    <div className="h-64 bg-gray-200 rounded"></div>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="p-8 text-center text-red-500">
                <AlertTriangle className="mx-auto h-12 w-12 mb-4" />
                <h2 className="text-xl font-bold">Error Loading Billing</h2>
                <p>{error}</p>
                <Button variant="outline" className="mt-4" onClick={fetchBillingData}>Retry</Button>
            </div>
        );
    }

    // Derived State
    const hasOverdue = data.past_invoices.some(inv => inv.status === "OVERDUE");
    const isGrace = data.account_status === "GRACE";
    const isBlocked = data.account_status === "BLOCKED";


    return (
        <div className={`p-8 max-w-7xl mx-auto space-y-8 ${styles.lightThemeWrapper}`}>

            {/* 1. Status Banners */}
            {isBlocked && (
                <Alert variant="destructive" className="border-2 border-red-600 bg-red-50 dark:bg-red-900/10">
                    <ShieldAlert className="h-5 w-5" />
                    <AlertTitle className="text-lg font-bold">Service Suspended</AlertTitle>
                    <AlertDescription>
                        Your account is blocked due to an overdue payment or administrative action.
                        API access is currently disabled. Please contact support to settle your outstanding balance.
                    </AlertDescription>
                </Alert>
            )}

            {(isGrace || (hasOverdue && !isBlocked)) && (
                <Alert className="border-2 border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10 text-yellow-900 dark:text-yellow-100">
                    <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                    <AlertTitle className="text-lg font-bold text-yellow-700 dark:text-yellow-400">Payment Overdue</AlertTitle>
                    <AlertDescription>
                        Your account is in a grace period. Please settle your outstanding invoices immediately to avoid service interruption.
                    </AlertDescription>
                </Alert>
            )}

            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Billing & Usage</h1>
                    <p className="text-muted-foreground mt-1">Manage your NeuroRouter Pro subscription and usage.</p>
                </div>
                <Badge variant={isBlocked ? "destructive" : "outline"} className="text-sm px-3 py-1">
                    Status: {data.account_status}
                </Badge>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* 2. Current Plan & Usage */}
                <Card className="shadow-md border-t-4 border-t-primary">
                    <CardHeader>
                        <div className="flex justify-between items-start">
                            <div>
                                <CardTitle className="text-primary">Current Cycle</CardTitle>
                                <CardDescription>{data.current_month.year_month}</CardDescription>
                            </div>
                            <Badge variant="secondary" className="bg-secondary/10 text-secondary hover:bg-secondary/20 border-secondary/20">
                                <Activity className="w-3 h-3 mr-1" /> Live Tracking
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">

                        {/* Costs Breakdown */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-primary/5 rounded-lg border border-primary/10">
                                <p className="text-xs font-medium text-primary/70 uppercase">Fixed Fee (Monthly)</p>
                                <p className="text-2xl font-bold mt-1 text-primary">₹{data.current_month.fixed_fee_inr.toLocaleString()}</p>
                            </div>
                            <div className="p-4 bg-primary/5 rounded-lg border border-primary/10">
                                <p className="text-xs font-medium text-primary/70 uppercase">Variable Usage (Est.)</p>
                                <p className="text-2xl font-bold mt-1 text-secondary">${data.current_month.estimated_variable_usd.toFixed(2)}</p>
                            </div>
                        </div>

                        <Separator />

                        {/* Token Usage Stats */}
                        <div className="space-y-6">

                            {/* Input Tokens */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center text-sm">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 bg-primary/10 rounded text-primary border border-primary/20">
                                            <FileText className="h-3 w-3" />
                                        </div>
                                        <span className="font-medium text-slate-700">Input Tokens</span>
                                    </div>
                                    <span className="text-slate-500">
                                        {data.current_month.input_tokens > 1_000_000 ? (
                                            <span className="text-red-600 font-medium">Over Quota</span>
                                        ) : (
                                            <span className="text-green-600 font-medium">Within Quota</span>
                                        )}
                                    </span>
                                </div>
                                <Progress value={Math.min((data.current_month.input_tokens / 1_000_000) * 100, 100)} className="h-2" />
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>{data.current_month.input_tokens.toLocaleString()} / 1,000,000 included</span>
                                    <span>{((data.current_month.input_tokens / 1_000_000) * 100).toFixed(0)}%</span>
                                </div>
                                {data.current_month.input_tokens > 1_000_000 && (
                                    <p className="text-xs text-red-600 mt-1">
                                        Charging $2.00/1M for {(data.current_month.input_tokens - 1_000_000).toLocaleString()} excess tokens.
                                    </p>
                                )}
                            </div>

                            {/* Output Tokens */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center text-sm">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 bg-secondary/10 rounded text-secondary border border-secondary/20">
                                            <FileText className="h-3 w-3" />
                                        </div>
                                        <span className="font-medium text-slate-700">Output Tokens</span>
                                    </div>
                                    <span className="text-slate-500">
                                        {data.current_month.output_tokens > 1_000_000 ? (
                                            <span className="text-red-600 font-medium">Over Quota</span>
                                        ) : (
                                            <span className="text-green-600 font-medium">Within Quota</span>
                                        )}
                                    </span>
                                </div>
                                <Progress value={Math.min((data.current_month.output_tokens / 1_000_000) * 100, 100)} className="h-2" />
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>{data.current_month.output_tokens.toLocaleString()} / 1,000,000 included</span>
                                    <span>{((data.current_month.output_tokens / 1_000_000) * 100).toFixed(0)}%</span>
                                </div>
                                {data.current_month.output_tokens > 1_000_000 && (
                                    <p className="text-xs text-red-600 mt-1">
                                        Charging $8.00/1M for {(data.current_month.output_tokens - 1_000_000).toLocaleString()} excess tokens.
                                    </p>
                                )}
                            </div>

                        </div>

                        <div className="pt-4 mt-2 bg-slate-50 -mx-6 -mb-6 px-6 py-4 border-t border-slate-100 flex justify-between items-center">
                            <span className="font-semibold text-slate-600">Estimated Total</span>
                            <span className="text-xl font-bold tracking-tight text-slate-900">{data.current_month.total_display}</span>
                        </div>
                    </CardContent>
                </Card>

                {/* 3. Rate Card & Info */}
                <div className="space-y-8">
                    <Card>
                        <CardHeader>
                            <CardTitle>NeuroRouter {data.current_plan?.name || "Pro"} Plan</CardTitle>
                            <CardDescription>Your active infrastructure plan.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm">
                            <div className="flex justify-between py-2 border-b">
                                <span>Infrastructure Fee</span>
                                <span className="font-medium">₹1,599 / mo</span>
                            </div>
                            <div className="flex justify-between py-2 border-b">
                                <span>Llama 3.3 70B Input</span>
                                <span className="font-medium">$2.00 / 1M tokens</span>
                            </div>
                            <div className="flex justify-between py-2 border-b">
                                <span>Llama 3.3 70B Output</span>
                                <span className="font-medium">$8.00 / 1M tokens</span>
                            </div>
                            <div className="flex justify-between py-2">
                                <span>Billing Cycle</span>
                                <span className="font-medium">Monthly (1st - End)</span>
                            </div>
                        </CardContent>
                        <CardFooter>
                            <p className="text-xs text-muted-foreground italic">
                                Bills are generated on the 1st of each month. Payment is due by the 5th.
                            </p>
                        </CardFooter>
                    </Card>

                    {/* Quick Actions (Mock) */}
                    <Card className="bg-white border shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-slate-900">Need Help?</CardTitle>
                            <CardDescription className="text-slate-500">Contact support for billing inquiries or custom enterprise plans.</CardDescription>
                        </CardHeader>
                        <CardFooter>
                            <Button variant="outline" className="w-full">Contact Support</Button>
                        </CardFooter>
                    </Card>
                </div>
            </div>

            {/* 4. Invoice History */}
            <Card>
                <CardHeader>
                    <CardTitle>Invoice History</CardTitle>
                    <CardDescription>View your past monthly statements.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground font-medium">
                                <tr>
                                    <th className="p-4">Invoice #</th>
                                    <th className="p-4">Month</th>
                                    <th className="p-4">Amount</th>
                                    <th className="p-4">Due Date</th>
                                    <th className="p-4">Status</th>
                                    <th className="p-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.past_invoices.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="p-8 text-center text-muted-foreground">
                                            No invoices generated yet.
                                        </td>
                                    </tr>
                                ) : (
                                    data.past_invoices.map((inv) => (
                                        <tr key={inv.invoice_number || inv.id} className="border-t hover:bg-muted/50 transition-colors">
                                            <td className="p-4 font-medium">{inv.invoice_number}</td>
                                            <td className="p-4">{inv.year_month}</td>
                                            <td className="p-4 font-mono">{getInvoiceTotal(inv)}</td>
                                            <td className="p-4 text-muted-foreground">{new Date(inv.due_date).toLocaleDateString()}</td>
                                            <td className="p-4">
                                                <Badge variant={getStatusBadgeVar(inv.status) as any}>{inv.status}</Badge>
                                            </td>
                                            <td className="p-4 text-right space-x-2">
                                                <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelectedInvoice(inv)}>Details</Button>
                                                {inv.id && (
                                                    <Button variant="outline" size="sm" className="h-8"
                                                        disabled={inv.status !== "PAID" || downloading === inv.id}
                                                        onClick={() => handleDownloadPDF(inv.id)}
                                                        title={inv.status !== "PAID" ? "PDF available after payment" : "Download PDF"}>
                                                        {downloading === inv.id ? "..." : "PDF"}
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Payment Reminder */}
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-5">
                <div className="flex items-start gap-3">
                    <CreditCard className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                    <div>
                        <h4 className="text-sm font-semibold text-blue-800">Payment Information</h4>
                        <p className="text-sm text-blue-700 mt-1">
                            Invoices are generated at the end of each month. Please pay within the due date
                            (1st of the following month) for uninterrupted service. A 5-day grace period is
                            provided after the due date. After the grace period, your account will be suspended
                            and API keys will be disabled until payment is received.
                        </p>
                    </div>
                </div>
            </div>

            {/* Invoice Detail Modal */}
            {selectedInvoice && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedInvoice(null)}>
                    <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
                        <CardHeader>
                            <div className="flex justify-between items-start">
                                <div>
                                    <CardTitle>Invoice {selectedInvoice.invoice_number}</CardTitle>
                                    <CardDescription>Period: {selectedInvoice.year_month}</CardDescription>
                                </div>
                                <Badge variant={getStatusBadgeVar(selectedInvoice.status) as any}>{selectedInvoice.status}</Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p className="text-muted-foreground">Due Date</p>
                                    <p className="font-medium">{new Date(selectedInvoice.due_date).toLocaleDateString()}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Grace Period End</p>
                                    <p className="font-medium">{new Date(selectedInvoice.grace_period_end).toLocaleDateString()}</p>
                                </div>
                                {selectedInvoice.total_input_tokens !== undefined && (
                                    <>
                                        <div>
                                            <p className="text-muted-foreground">Input Tokens</p>
                                            <p className="font-medium">{selectedInvoice.total_input_tokens?.toLocaleString()}</p>
                                        </div>
                                        <div>
                                            <p className="text-muted-foreground">Output Tokens</p>
                                            <p className="font-medium">{selectedInvoice.total_output_tokens?.toLocaleString()}</p>
                                        </div>
                                    </>
                                )}
                                {selectedInvoice.fixed_fee_inr !== undefined && (
                                    <>
                                        <div>
                                            <p className="text-muted-foreground">Fixed Fee</p>
                                            <p className="font-medium">₹{selectedInvoice.fixed_fee_inr?.toLocaleString()}</p>
                                        </div>
                                        <div>
                                            <p className="text-muted-foreground">Variable Cost</p>
                                            <p className="font-medium">${selectedInvoice.variable_cost_usd?.toFixed(2)}</p>
                                        </div>
                                    </>
                                )}
                            </div>
                            <Separator />
                            <div className="flex justify-between items-center">
                                <span className="font-semibold">Total Due</span>
                                <span className="text-xl font-bold">{getInvoiceTotal(selectedInvoice)}</span>
                            </div>
                        </CardContent>
                        <CardFooter className="flex gap-2">
                            {selectedInvoice.id && (
                                <Button variant="outline" className="flex-1"
                                    disabled={selectedInvoice.status !== "PAID" || downloading === selectedInvoice.id}
                                    onClick={() => handleDownloadPDF(selectedInvoice.id)}
                                    title={selectedInvoice.status !== "PAID" ? "PDF available after payment" : ""}>
                                    {downloading === selectedInvoice.id ? "Generating..." : selectedInvoice.status !== "PAID" ? "PDF (Pay first)" : "Download PDF"}
                                </Button>
                            )}
                            <Button variant="ghost" className="flex-1" onClick={() => setSelectedInvoice(null)}>Close</Button>
                        </CardFooter>
                    </Card>
                </div>
            )}

        </div>
    );
}
