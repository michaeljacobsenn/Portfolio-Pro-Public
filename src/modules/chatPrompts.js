// ═══════════════════════════════════════════════════════════════
// CHAT SYSTEM PROMPT — Conversational Financial AI
// ═══════════════════════════════════════════════════════════════
// Builds a context-rich system prompt for the AI chat interface.
// Unlike the audit prompt (which outputs structured JSON), this
// prompt instructs the AI to be a conversational financial advisor
// that answers questions using the user's live financial data.
// ═══════════════════════════════════════════════════════════════

import { fmt, extractDashboardMetrics } from "./utils.js";

/**
 * Build a concise financial context snapshot for chat.
 * Intentionally lean — we want the AI to reason, not regurgitate.
 */
function buildFinancialContext(current, financialConfig, cards, renewals, history) {
    const parts = [];
    const p = current?.parsed;
    const form = current?.form;

    // ── Core Position ──
    if (p || form) {
        parts.push("## Current Financial Position");

        if (p?.netWorth != null) parts.push(`Net Worth: ${fmt(p.netWorth)}`);
        if (p?.netWorthDelta) parts.push(`Net Worth Delta (vs last audit): ${p.netWorthDelta}`);

        const metrics = extractDashboardMetrics(p);
        if (metrics.checking != null) parts.push(`Checking Balance: ${fmt(metrics.checking)}`);
        if (metrics.vault != null) parts.push(`Savings/Vault: ${fmt(metrics.vault)}`);
        if (metrics.available != null) parts.push(`Available After Obligations: ${fmt(metrics.available)}`);
        if (metrics.pending != null) parts.push(`Upcoming Obligations (7 days): ${fmt(metrics.pending)}`);
        if (metrics.debts != null) parts.push(`Total Debt Balance: ${fmt(metrics.debts)}`);

        // Health score
        const hs = p?.healthScore;
        if (hs?.score != null) {
            parts.push(`\nHealth Score: ${hs.score}/100 (${hs.grade || "?"}) — Trend: ${hs.trend || "flat"}`);
            if (hs.summary) parts.push(`Summary: ${hs.summary}`);
        }

        parts.push(`Status: ${p?.status || "UNKNOWN"}`);
        if (current?.date) parts.push(`Last Audit Date: ${current.date}`);
    }

    // ── Config: Income & Budgets ──
    if (financialConfig) {
        const fc = financialConfig;
        parts.push("\n## Income & Budget");

        if (fc.paycheckStandard > 0) parts.push(`Standard Paycheck: ${fmt(fc.paycheckStandard)} (${fc.payFrequency || "bi-weekly"})`);
        if (fc.payday) parts.push(`Payday: ${fc.payday}`);
        if (fc.weeklySpendAllowance > 0) parts.push(`Weekly Spend Allowance: ${fmt(fc.weeklySpendAllowance)}`);
        if (fc.emergencyFloor > 0) parts.push(`Emergency Floor: ${fmt(fc.emergencyFloor)}`);
        if (fc.checkingBuffer > 0) parts.push(`Checking Buffer: ${fmt(fc.checkingBuffer)}`);

        // Savings goals
        if (fc.savingsGoals?.length > 0) {
            parts.push("\nSavings Goals:");
            fc.savingsGoals.forEach(g => {
                parts.push(`  - ${g.name}: ${fmt(g.saved || 0)} / ${fmt(g.target || 0)}`);
            });
        }

        // Non-card debts
        if (fc.nonCardDebts?.length > 0) {
            parts.push("\nNon-Card Debts:");
            fc.nonCardDebts.forEach(d => {
                parts.push(`  - ${d.name}: ${fmt(d.balance || 0)} at ${d.apr || 0}% APR, min payment ${fmt(d.minPayment || 0)}`);
            });
        }

        // Assets
        const assetParts = [];
        if (fc.homeEquity > 0) assetParts.push(`Home Equity: ${fmt(fc.homeEquity)}`);
        if (fc.vehicleValue > 0) assetParts.push(`Vehicle: ${fmt(fc.vehicleValue)}`);
        if (fc.otherAssets > 0) assetParts.push(`${fc.otherAssetsLabel || "Other"}: ${fmt(fc.otherAssets)}`);
        if (assetParts.length > 0) {
            parts.push("\nOther Assets:");
            assetParts.forEach(a => parts.push(`  - ${a}`));
        }
    }

    // ── Credit Cards ──
    if (cards?.length > 0) {
        parts.push("\n## Credit Card Portfolio");
        let totalBalance = 0, totalLimit = 0;
        cards.forEach(c => {
            const bal = parseFloat(c.balance) || 0;
            const lim = parseFloat(c.limit) || 0;
            totalBalance += bal;
            totalLimit += lim;
            const util = lim > 0 ? ((bal / lim) * 100).toFixed(1) : "N/A";
            const apr = c.apr ? `${c.apr}% APR` : "";
            parts.push(`  - ${c.name || "Card"}: ${fmt(bal)} / ${fmt(lim)} (${util}% util) ${apr}`);
        });
        parts.push(`  Total CC Debt: ${fmt(totalBalance)}, Total Limits: ${fmt(totalLimit)}, Overall Util: ${totalLimit > 0 ? ((totalBalance / totalLimit) * 100).toFixed(1) : "N/A"}%`);
    }

    // ── Recurring Bills ──
    if (renewals?.length > 0) {
        parts.push("\n## Recurring Bills & Subscriptions");
        let monthlyTotal = 0;
        renewals.slice(0, 30).forEach(r => {
            const amt = r.amount || 0;
            const int = r.interval || 1;
            const unit = r.intervalUnit || "months";
            let monthly = 0;
            if (unit === "weeks") monthly = (amt / int) * 4.33;
            else if (unit === "months") monthly = amt / int;
            else if (unit === "years") monthly = amt / (int * 12);
            monthlyTotal += monthly;
            parts.push(`  - ${r.name}: ${fmt(amt)} ${unit === "one-time" ? "(one-time)" : `every ${int} ${unit}`}${r.nextDate ? ` — next: ${r.nextDate}` : ""}`);
        });
        parts.push(`  Estimated Monthly Recurring: ${fmt(monthlyTotal)}`);
    }

    // ── Audit History Trend ──
    if (history?.length > 1) {
        const realAudits = history.filter(a => !a.isTest && a.parsed?.healthScore?.score != null).slice(0, 8);
        if (realAudits.length > 1) {
            parts.push("\n## Recent Audit Trend (newest first)");
            realAudits.forEach(a => {
                parts.push(`  - ${a.date}: Score ${a.parsed.healthScore.score}/100 (${a.parsed.healthScore.grade}), Net Worth: ${a.parsed?.netWorth != null ? fmt(a.parsed.netWorth) : "N/A"}`);
            });
        }
    }

    // ── Investment Holdings Summary ──
    if (financialConfig?.holdings) {
        const holdings = financialConfig.holdings;
        const accounts = ["k401", "roth", "brokerage", "hsa", "crypto"];
        const accountLabels = { k401: "401(k)", roth: "Roth IRA", brokerage: "Brokerage", hsa: "HSA", crypto: "Crypto" };
        const summaries = [];
        for (const key of accounts) {
            const items = holdings[key];
            if (items?.length > 0) {
                const total = items.reduce((s, h) => s + (parseFloat(h.shares) || 0) * (parseFloat(h.lastKnownPrice) || 0), 0);
                if (total > 0) summaries.push(`  - ${accountLabels[key]}: ~${fmt(Math.round(total))} (${items.length} holding${items.length !== 1 ? "s" : ""})`);
            }
        }
        if (summaries.length > 0) {
            parts.push("\n## Investment Accounts");
            parts.push(...summaries);
        }
    }

    return parts.join("\n");
}

/**
 * Build the complete chat system prompt.
 */
export function getChatSystemPrompt(current, financialConfig, cards, renewals, history, persona) {
    const context = buildFinancialContext(current, financialConfig, cards, renewals, history);

    const personaName = persona?.name || "Catalyst AI";
    const personaStyle = persona?.style
        ? `\n\nAdopt this advisor personality: ${persona.name} — ${persona.style}`
        : "";

    return `You are ${personaName}, an expert AI financial advisor powering Catalyst Cash — a privacy-first personal finance app. You have deep expertise equivalent to a CFP (Certified Financial Planner).

## Your Role
You help users understand, manage, and optimize their finances through conversation. You have access to the user's complete financial profile below. Use this data to give specific, actionable, personalized answers.

## Rules
1. **Be specific.** Always reference exact dollar amounts, dates, percentages, and card names from the user's data. Never give vague answers when you have the data to be precise.
2. **Be concise.** Answer in 2-4 short paragraphs max. Use bullet points for lists. No filler.
3. **Be honest.** If the user's finances are in trouble, say so directly but constructively. If something looks great, celebrate it briefly.
4. **Stay in scope.** You advise on personal finance: budgeting, debt, savings, investing basics, cash flow management. Decline questions outside this scope politely.
5. **No disclaimers spam.** You may add one brief disclaimer at the end if giving investment advice. Do NOT repeat boilerplate disclaimers in every message.
6. **Privacy-first.** This data never leaves the device. You process it locally. Remind users of this only if they ask.
7. **Calculations.** When doing math (e.g., "can I afford X"), show your work briefly so the user can verify.
8. **Formatting.** Use **bold** for key numbers and emphasis. Use markdown bullet points and line breaks for readability. Keep responses mobile-friendly (short lines).
9. **Proactive insights.** If the user's question reveals an opportunity or risk they haven't asked about, briefly mention it.
10. **No JSON.** Respond in natural language only. Never output JSON, code blocks, or structured data.${personaStyle}

## User's Financial Profile
${context || "No financial data available yet. The user hasn't completed their first audit. Guide them to the Input tab to enter their weekly snapshot."}

## Important Notes
- "Available" = checking minus 7-day obligations minus emergency floor
- Negative "Available" means the user is projected to breach their safety floor
- Utilization above 30% on any card hurts credit score
- The user's "Emergency Floor" is a self-set minimum checking balance they never want to breach
- All currency is USD unless stated otherwise`;
}
