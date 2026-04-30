import type { IssueType } from "./state.js";

// Maps issue type → preferred agent name patterns (first match wins)
export const ROLE_PRIORITY: Record<IssueType, string[]> = {
  backend_bug: ["Backend Engineer", "Full Stack Engineer", "CTO"],
  frontend_bug: ["Frontend Engineer", "Full Stack Engineer", "CTO"],
  design_task: ["UI/UX Designer", "Brand Designer", "Design System"],
  qa_task: ["QA Engineer", "Backend Engineer"],
  devops_task: ["DevOps Engineer", "SRE", "Platform Engineer"],
  product_task: ["Product Manager", "Business Analyst", "Product Owner"],
  architecture: ["CTO", "System Designer", "Engineering Manager"],
  data_task: ["Data Engineer", "AI/ML Engineer", "Backend Engineer"],
  security_task: ["Security Engineer", "CTO", "DevOps Engineer"],
  infra_task: ["DevOps Engineer", "Platform Engineer", "SRE"],
  unknown: ["CTO", "Engineering Manager"],
};

// Keyword-based classification fallback (no Claude needed)
export function classifyByKeywords(title: string, description: string): IssueType {
  const text = `${title} ${description}`.toLowerCase();
  if (/\[bug\]|import.?error|crash|exception|traceback|fix|broken|undefined|null pointer/.test(text)) {
    if (/frontend|react|ui|css|html|page|component|vue|svelte/.test(text)) return "frontend_bug";
    return "backend_bug";
  }
  if (/design|wireframe|ui spec|figma|prototype|mockup|accessibility/.test(text)) return "design_task";
  if (/test|qa|coverage|e2e|unit test|integration test|spec/.test(text)) return "qa_task";
  if (/devops|deploy|ci\/cd|docker|kubernetes|terraform|infra|pipeline/.test(text)) return "devops_task";
  if (/prd|product|roadmap|feature request|user story|market/.test(text)) return "product_task";
  if (/architect|system design|adr|schema|database design/.test(text)) return "architecture";
  if (/data|analytics|ml|model|etl|pipeline|dashboard|metric/.test(text)) return "data_task";
  if (/security|auth|vulnerability|cve|penetration|owasp/.test(text)) return "security_task";
  if (/infra|server|network|ssl|load balancer|scaling/.test(text)) return "infra_task";
  return "unknown";
}
