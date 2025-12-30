import { Card, CardContent } from "@/components/ui/card"
import styles from "./docs.module.css"

export default function DocsPage() {
    return (
        <div className={styles.section}>
            <section id="introduction" className={styles.article}>
                <div>
                    <h1 className={styles.title}>Introduction</h1>
                    <p className={styles.text}>
                        NeuroStack is an OpenAI-compatible API router that provides a unified interface for accessing LLMs with built-in enhanced security and usage controls.
                    </p>
                </div>
            </section>

            <section id="authentication" className={styles.article}>
                <div>
                    <h2 className={styles.subtitle}>Authentication</h2>
                    <p className={styles.text}>
                        All API requests must be authenticated using a <span className="font-mono text-sm bg-slate-100 px-1 py-0.5 rounded border border-slate-200 text-slate-700">Bearer</span> token.
                        Include your API key in the Authorization header of every request.
                    </p>
                </div>
                <Card className={styles.codeBlock}>
                    <CardContent className="p-6">
                        <div className="flex items-center gap-2 mb-4 border-b border-slate-200 pb-2">
                            <div className="flex gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-red-400/80"></div>
                                <div className="w-3 h-3 rounded-full bg-yellow-400/80"></div>
                                <div className="w-3 h-3 rounded-full bg-green-400/80"></div>
                            </div>
                            <div className="text-xs text-slate-400 ml-2 font-mono">http headers</div>
                        </div>
                        <code className="text-sm font-mono text-emerald-600 block bg-slate-50 p-2 rounded border border-slate-100">
                            Authorization: Bearer neurostack_...
                        </code>
                    </CardContent>
                </Card>
            </section>

            <section id="api-keys" className={styles.article}>
                <div>
                    <h2 className={styles.subtitle}>API Keys</h2>
                    <p className={styles.text}>
                        You can generate API keys in the <a href="/dashboard" className="text-blue-600 hover:text-blue-700 transition-colors underline decoration-blue-200 underline-offset-4 font-medium">Dashboard</a>.
                        Keys are prefixed with <code className="font-mono text-sm bg-slate-100 px-1 py-0.5 rounded border border-slate-200 text-slate-700">neurostack_</code> for easy identification.
                    </p>
                </div>
            </section>

            <section id="chat-completions" className={styles.article}>
                <div>
                    <h2 className={styles.subtitle}>Chat Completions</h2>
                    <p className={styles.text}>
                        Compatible with OpenAI's <code className="rounded bg-slate-100 px-1 py-0.5 text-sm md:text-base border border-slate-200">/v1/chat/completions</code> endpoint.
                    </p>
                </div>
                <Card className={styles.codeBlock}>
                    <CardContent className="p-4 font-mono text-sm leading-relaxed text-slate-700">
                        <div className="mb-2 font-semibold text-purple-600">POST /v1/chat/completions</div>
                        <div className="text-slate-500">{"{"}</div>
                        <div className="pl-4">
                            <span className="text-blue-600">"model"</span>: <span className="text-orange-600">"llama-3.3-70b"</span>,
                        </div>
                        <div className="pl-4">
                            <span className="text-blue-600">"messages"</span>: [
                        </div>
                        <div className="pl-8">
                            {"{"} <span className="text-blue-600">"role"</span>: <span className="text-orange-600">"user"</span>, <span className="text-blue-600">"content"</span>: <span className="text-orange-600">"Hello!"</span> {"}"}
                        </div>
                        <div className="pl-4">]</div>
                        <div className="text-slate-500">{"}"}</div>
                    </CardContent>
                </Card>
            </section>

            <section id="models" className={styles.article}>
                <div>
                    <h2 className={styles.subtitle}>Models</h2>
                    <p className={styles.text}>
                        Current supported models routed via Groq for ultra-low latency:
                    </p>
                    <div className="mt-6 grid gap-4 grid-cols-1 md:grid-cols-2">
                        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow">
                            <div className="text-slate-900 font-semibold mb-1">Llama 3.3 70B Versatile</div>
                            <div className="text-sm text-slate-500">High intelligence, general purpose</div>
                        </div>
                        <div className="p-4 rounded-xl border border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed">
                            <div className="text-slate-700 font-semibold mb-1">Mixtral 8x7B <span className="text-xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded ml-2">Soon</span></div>
                            <div className="text-sm text-slate-400">Sparse Mixture-of-Experts</div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    )
}
