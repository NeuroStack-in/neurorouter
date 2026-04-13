"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Search, Shield, ShieldAlert, CheckCircle, FileText, Calendar, DollarSign, CreditCard } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import styles from "../../dashboard/billing/billing.module.css"; // Reuse white theme
import { generateInvoicePDF } from "@/lib/invoice-pdf";

// --- Types (Mirroring Go Backend — camelCase JSON) ---
interface AdminUserBillingSummary {
    userId: string;
    email: string;
    fullName: string;
    accountStatus: string;
    currentMonthUsage?: {
        totalDisplay: string;
    } | null;
    lastInvoiceStatus?: string | null;
}

interface BillingCycleResponse {
    id: string;
    invoiceNumber: string;
    yearMonth: string;
    status: string;
    dueDate: string;
    gracePeriodEnd?: string;
    totalDueDisplay?: string;
    calculatedCosts?: {
        totalDueDisplay: string;
    };
}

interface BillingDashboardResponse {
    currentMonth: any;
    pastInvoices: BillingCycleResponse[];
    accountStatus: string;
}

export default function AdminBillingPage() {
    const [users, setUsers] = useState<AdminUserBillingSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    // Actions State
    const [selectedUser, setSelectedUser] = useState<AdminUserBillingSummary | null>(null);
    const [detailedBilling, setDetailedBilling] = useState<BillingDashboardResponse | null>(null);
    const [billingLoading, setBillingLoading] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const token = localStorage.getItem("jwt");
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/users`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                setUsers(await res.json());
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const fetchUserBilling = async (userId: string) => {
        setBillingLoading(true);
        try {
            const token = localStorage.getItem("jwt");
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/users/${userId}/billing`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const raw = await res.json();
                // Normalize: backend returns past_invoices (snake) but type uses pastInvoices (camel)
                setDetailedBilling({
                    currentMonth: raw.currentMonth || raw.current_month,
                    pastInvoices: raw.pastInvoices || raw.past_invoices || [],
                    accountStatus: raw.accountStatus || raw.account_status,
                });
            }
        } catch (e) {
            console.error(e);
        } finally {
            setBillingLoading(false);
        }
    };

    const handleManageClick = (user: AdminUserBillingSummary) => {
        setSelectedUser(user);
        setDetailedBilling(null); // Reset
        setDialogOpen(true);
        fetchUserBilling(user.userId); // Fetch details immediately
    };

    // Action Handlers
    const handleDownloadPdf = async (invoiceId: string, invoiceNumber: string) => {
        const inv = detailedBilling?.pastInvoices?.find(i => i.id === invoiceId);
        generateInvoicePDF({
            invoiceNumber: inv?.invoiceNumber || invoiceNumber,
            yearMonth: inv?.yearMonth || "",
            status: inv?.status || "PENDING",
            dueDate: inv?.dueDate,
            inputTokens: (inv as any)?.inputTokens || 0,
            outputTokens: (inv as any)?.outputTokens || 0,
            fixedFeeInr: (inv as any)?.fixedFeeInr || 1599,
            variableCostUsd: (inv as any)?.variableCostUsd || 0,
            totalDisplay: inv?.totalDueDisplay || inv?.calculatedCosts?.totalDueDisplay || "N/A",
            userEmail: selectedUser?.email,
        });
    };

    const handleMarkPaid = async (invoiceId: string) => {
        if (!confirm("Are you sure you want to mark this invoice as PAYMENT RECEIVED? This will unlock the account if blocked.")) return;

        const token = localStorage.getItem("jwt");
        try {
            // Correct endpoint is POST /admin/invoices/{id}/pay
            const url = `${process.env.NEXT_PUBLIC_API_URL}/admin/invoices/${invoiceId}/pay`;
            const res = await fetch(url, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) {
                const err = await res.json();
                alert(`Error: ${err.detail || "Failed"}`);
                return;
            }

            // Refresh
            if (selectedUser) {
                fetchUserBilling(selectedUser.userId);
                fetchUsers(); // Refresh main list too to update banners
            }
        } catch (e) {
            alert("Network error");
        }
    };

    const [approvalKey, setApprovalKey] = useState("");
    const [rejectReason, setRejectReason] = useState("");

    const handleMarkUnpaid = async (invoiceId: string) => {
        if (!confirm("Mark this invoice as UNPAID? The user's billing status will be recalculated.")) return;
        const token = localStorage.getItem("jwt");
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/invoices/${invoiceId}/unpay`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok && selectedUser) {
                fetchUserBilling(selectedUser.userId);
                fetchUsers();
            }
        } catch (e) {
            alert("Network error");
        }
    };

    const handleEditDueDate = async (invoiceId: string, currentDueDate: string) => {
        const newDate = prompt("Enter new due date (YYYY-MM-DD):", currentDueDate?.split("T")[0]);
        if (!newDate) return;
        const token = localStorage.getItem("jwt");
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/invoices/${invoiceId}`, {
                method: "PUT",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ due_date: newDate + "T00:00:00Z" })
            });
            if (res.ok && selectedUser) {
                fetchUserBilling(selectedUser.userId);
            }
        } catch (e) {
            alert("Network error");
        }
    };

    const handleReject = async () => {
        if (!rejectReason.trim()) { alert("Reason is required"); return; }
        const token = localStorage.getItem("jwt");
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/users/${selectedUser?.userId}/reject`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ reason: rejectReason })
            });
            if (res.ok) {
                setRejectReason("");
                fetchUsers();
                setSelectedUser(null);
            } else {
                const err = await res.json();
                alert(`Error: ${err.detail}`);
            }
        } catch (e) {
            alert("Network error");
        }
    };

    const handleAction = async (action: string, payload: any) => {
        const token = localStorage.getItem("jwt");
        let url = `${process.env.NEXT_PUBLIC_API_URL}/admin/users/${selectedUser?.userId}/status`;
        let body: any = {};

        if (action === "BLOCK") {
            body = { status: "BLOCKED", reason: "Manual Admin Block" };
        } else if (action === "ACTIVATE") {
            body = { status: "ACTIVE", reason: "Manual Admin Activation" };
        } else if (action === "APPROVE") {
            // Different endpoint for approval
            url = `${process.env.NEXT_PUBLIC_API_URL}/admin/users/${selectedUser?.userId}/approve`;
            body = { groq_api_key: approvalKey };
        }

        const res = await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const err = await res.json();
            alert(`Error: ${err.detail}`);
            return;
        }

        setApprovalKey("");
        fetchUsers(); // Refresh
        setSelectedUser(null);
    };

    const filteredUsers = users.filter(u =>
        u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.userId.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className={`p-8 max-w-7xl mx-auto space-y-8 ${styles.lightThemeWrapper}`}>
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900">Billing Administration</h1>
                    <p className="text-muted-foreground mt-1">Manage user billing status, generate invoices, and enforce limits.</p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={fetchUsers} variant="outline">Refresh</Button>
                </div>
            </div>

            <Card className="bg-white shadow-sm border">
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <CardTitle>User Registry</CardTitle>
                        <div className="relative w-64">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search email or ID..."
                                className="pl-8"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>User</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Current Usage</TableHead>
                                <TableHead>Last Invoice</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow key="loading">
                                    <TableCell colSpan={5} className="text-center h-24">Loading users...</TableCell>
                                </TableRow>
                            ) : filteredUsers.length === 0 ? (
                                <TableRow key="empty">
                                    <TableCell colSpan={5} className="text-center h-24">No users found.</TableCell>
                                </TableRow>
                            ) : (
                                filteredUsers.map((user) => (
                                    <TableRow key={user.userId}>
                                        <TableCell>
                                            <div className="font-medium">{user.email}</div>
                                            <div className="text-xs text-muted-foreground font-mono">{user.userId}</div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={user.accountStatus === "BLOCKED" ? "destructive" : user.accountStatus === "PENDING_APPROVAL" ? "secondary" : "outline"}>
                                                {user.accountStatus}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            {user.currentMonthUsage ? user.currentMonthUsage.totalDisplay : "-"}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="secondary">{user.lastInvoiceStatus || "None"}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button size="sm" variant="outline" onClick={() => handleManageClick(user)}>Manage</Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Manage User Dialog — controlled, rendered once outside the loop */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                {selectedUser && (
                                                <DialogContent className={styles.lightThemeWrapper}>
                                                    <DialogHeader>
                                                        <DialogTitle>Manage User: {selectedUser.email}</DialogTitle>
                                                        <DialogDescription>
                                                            ID: {selectedUser.userId}
                                                        </DialogDescription>
                                                    </DialogHeader>

                                                    <Tabs defaultValue="overview" className="w-full">
                                                        <TabsList className="grid w-full grid-cols-2">
                                                            <TabsTrigger value="overview">Overview</TabsTrigger>
                                                            <TabsTrigger value="invoices">Invoices & Billing</TabsTrigger>
                                                        </TabsList>

                                                        <TabsContent value="overview" className="space-y-4 py-4">
                                                            {selectedUser.accountStatus === "PENDING_APPROVAL" ? (
                                                                <div className="space-y-4">
                                                                    <div className="p-3 bg-blue-50 text-blue-800 text-sm rounded-md">
                                                                        User is pending approval. Please validate a Groq Key to activate.
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        <Label>Groq Cloud API Key</Label>
                                                                        <Input
                                                                            type="password"
                                                                            placeholder="gsk_..."
                                                                            value={approvalKey}
                                                                            onChange={(e) => setApprovalKey(e.target.value)}
                                                                        />
                                                                    </div>
                                                                    <Button className="w-full" onClick={() => handleAction("APPROVE", null)}>
                                                                        Approve & Activate
                                                                    </Button>
                                                                    <div className="border-t pt-4 space-y-2">
                                                                        <Label>Reject with Reason</Label>
                                                                        <Input
                                                                            placeholder="Enter rejection reason..."
                                                                            value={rejectReason}
                                                                            onChange={(e) => setRejectReason(e.target.value)}
                                                                        />
                                                                        <Button variant="destructive" className="w-full" onClick={handleReject}>
                                                                            Reject User
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="flex gap-4">
                                                                    {selectedUser.accountStatus !== "BLOCKED" ? (
                                                                        <Button variant="destructive" className="w-full" onClick={() => handleAction("BLOCK", null)}>
                                                                            <ShieldAlert className="mr-2 h-4 w-4" /> Block User
                                                                        </Button>
                                                                    ) : (
                                                                        <Button variant="default" className="w-full bg-green-600 hover:bg-green-700" onClick={() => handleAction("ACTIVATE", null)}>
                                                                            <CheckCircle className="mr-2 h-4 w-4" /> Unblock User
                                                                        </Button>
                                                                    )}
                                                                </div>
                                                            )}
                                                            <div className="text-sm text-muted-foreground mt-4">
                                                                <p><strong>User ID:</strong> {selectedUser.userId}</p>
                                                                <p><strong>Email:</strong> {selectedUser.email}</p>
                                                            </div>
                                                        </TabsContent>

                                                        <TabsContent value="invoices" className="py-4">
                                                            {billingLoading ? (
                                                                <div className="text-center py-4">Loading billing details...</div>
                                                            ) : detailedBilling ? (
                                                                <div className="space-y-4">
                                                                    <div className="grid grid-cols-2 gap-4">
                                                                        <div className="p-3 border rounded-md bg-slate-50">
                                                                            <div className="text-xs text-muted-foreground">Current Month Estimate</div>
                                                                            <div className="text-lg font-semibold">{detailedBilling.currentMonth?.totalDisplay}</div>
                                                                        </div>
                                                                        <div className="p-3 border rounded-md bg-slate-50">
                                                                            <div className="text-xs text-muted-foreground">Status</div>
                                                                            <Badge>{detailedBilling.accountStatus}</Badge>
                                                                        </div>
                                                                    </div>

                                                                    <div className="rounded-md border">
                                                                        <Table>
                                                                            <TableHeader>
                                                                                <TableRow>
                                                                                    <TableHead>Invoice</TableHead>
                                                                                    <TableHead>Status</TableHead>
                                                                                    <TableHead>Total</TableHead>
                                                                                    <TableHead className="text-right">Actions</TableHead>
                                                                                </TableRow>
                                                                            </TableHeader>
                                                                            <TableBody>
                                                                                {!detailedBilling.pastInvoices?.length ? (
                                                                                    <TableRow>
                                                                                        <TableCell colSpan={4} className="text-center">No invoices found.</TableCell>
                                                                                    </TableRow>
                                                                                ) : (
                                                                                    detailedBilling.pastInvoices.map((inv) => (
                                                                                        <TableRow key={inv.id}>
                                                                                            <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                                                                                            <TableCell>
                                                                                                <Badge variant={inv.status === "PAID" ? "default" : inv.status === "OVERDUE" ? "destructive" : "secondary"}>
                                                                                                    {inv.status}
                                                                                                </Badge>
                                                                                            </TableCell>
                                                                                            <TableCell>{inv.totalDueDisplay || inv.calculatedCosts?.totalDueDisplay || "N/A"}</TableCell>
                                                                                            <TableCell className="text-right flex justify-end gap-2">
                                                                                                {inv.status !== "PAID" && (
                                                                                                    <Button size="icon" variant="ghost" title="Mark as Paid" onClick={() => handleMarkPaid(inv.id)} className="text-green-600 hover:text-green-700 hover:bg-green-50">
                                                                                                        <CreditCard className="h-4 w-4" />
                                                                                                    </Button>
                                                                                                )}
                                                                                                {inv.status === "PAID" && (
                                                                                                    <Button size="icon" variant="ghost" title="Mark Unpaid" onClick={() => handleMarkUnpaid(inv.id)} className="text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50">
                                                                                                        <AlertCircle className="h-4 w-4" />
                                                                                                    </Button>
                                                                                                )}
                                                                                                <Button size="icon" variant="ghost"
                                                                                                    title={inv.status !== "PAID" ? "PDF available after payment" : "Download PDF"}
                                                                                                    disabled={inv.status !== "PAID"}
                                                                                                    onClick={() => handleDownloadPdf(inv.id, inv.invoiceNumber)}>
                                                                                                    <FileText className="h-4 w-4" />
                                                                                                </Button>
                                                                                                <Button size="icon" variant="ghost" title="Edit Due Date" onClick={() => handleEditDueDate(inv.id, inv.dueDate)}>
                                                                                                    <Calendar className="h-4 w-4" />
                                                                                                </Button>
                                                                                            </TableCell>
                                                                                        </TableRow>
                                                                                    ))
                                                                                )}
                                                                            </TableBody>
                                                                        </Table>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="text-red-500">Failed to load billing data.</div>
                                                            )}
                                                        </TabsContent>
                                                    </Tabs>
                                                </DialogContent>
                )}
            </Dialog>
        </div>
    );
}

function Separator() {
    return <div className="h-[1px] bg-slate-200 my-4" />;
}
