import { Card, CardContent } from "@/components/ui/card"
import styles from "./docs.module.css"
import { fetchModels, MODEL_METADATA } from "@/lib/models"
import { ShieldCheck, Cpu } from "lucide-react"

export default async function DocsPage() {
    const models = await fetchModels()

    return (
        <div className={styles.section}>
            <section id="introduction" className={styles.article}>
                <div>
                    <h1 className={styles.title}>Introduction</h1>
                    <p className={styles.text}>
                        NeuroRouter is an OpenAI-compatible API router that provides a unified interface for accessing LLMs with built-in enhanced security and usage controls.
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
                            Authorization: Bearer neurorouter_...
                        </code>
                    </CardContent>
                </Card>
            </section>

            <section id="api-keys" className={styles.article}>
                <div>
                    <h2 className={styles.subtitle}>API Keys</h2>
                    <p className={styles.text}>
                        You can generate API keys in the <a href="/dashboard" className="text-blue-600 hover:text-blue-700 transition-colors underline decoration-blue-200 underline-offset-4 font-medium">Dashboard</a>.
                        Keys are prefixed with <code className="font-mono text-sm bg-slate-100 px-1 py-0.5 rounded border border-slate-200 text-slate-700">neurorouter_</code> for easy identification.
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
                            <span className="text-blue-600">"model"</span>: <span className="text-orange-600">"llama-3.3-70b-versatile"</span>,
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
                    <h2 className={styles.subtitle}>Available Models (Self-Hosted)</h2>
                    <p className={styles.text}>
                        All models listed below are self-hosted and optimized within NeuroRouter infrastructure.
                    </p>

                    <div className="my-6 grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-2">
                        {models.map((model) => {
                            const metadata = MODEL_METADATA[model.id] || { context_window: 0, max_output_tokens: 0 }

                            return (
                                <div key={model.id} className="group relative overflow-hidden rounded-xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200">
                                    {/* Top Badge */}
                                    <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity" />

                                    <div className="p-5">
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                                                <ShieldCheck className="w-3 h-3 mr-1" />
                                                Self-Hosted in NeuroRouter Infra
                                            </div>
                                        </div>

                                        <h3 className="font-bold text-slate-900 text-lg mb-2 break-all">{model.id}</h3>

                                        {metadata.description && (
                                            <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                                                {metadata.description}
                                            </p>
                                        )}

                                        <div className="grid grid-cols-2 gap-3 text-xs mt-4 pt-4 border-t border-slate-100">
                                            <div>
                                                <span className="text-slate-400 block mb-0.5">Context Window</span>
                                                <span className="font-mono font-medium text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded">
                                                    {metadata.context_window > 0 ? metadata.context_window.toLocaleString() : "N/A"}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-slate-400 block mb-0.5">Max Output</span>
                                                <span className="font-mono font-medium text-slate-700 bg-slate-50 px-1.5 py-0.5 rounded">
                                                    {metadata.max_output_tokens > 0 ? metadata.max_output_tokens.toLocaleString() : "N/A"}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-slate-400 block mb-0.5">Model Origin</span>
                                                <span className="font-medium text-slate-700">
                                                    {model.owned_by}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-slate-400 block mb-0.5">Infrastructure</span>
                                                <span className="font-medium text-emerald-700 flex items-center">
                                                    <Cpu className="w-3 h-3 mr-1" />
                                                    NeuroRouter
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {/* Disclaimer Banner */}
                    <div className="mt-8 p-4 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5">
                                <ShieldCheck className="w-5 h-5 text-slate-400" />
                            </div>
                            <div>
                                <p className="font-semibold text-slate-800 mb-1">Infrastructure Guarantee</p>
                                <p className="leading-relaxed">
                                    All listed models are self-hosted and optimized within NeuroRouter infrastructure.
                                    Groq Cloud is a competitor and is not used for inference or routing.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    )
}
