// // src/tools/rallyTool.ts
// // Handles all Rally/CA Agile Central API interactions

// import axios, { AxiosInstance } from "axios";
// import type { RallyTicket } from "../types";
// import type { ProjectConfig } from "../types";

// export class RallyClient {
//   private client: AxiosInstance;
//   private baseUrl: string;

//   constructor(config: ProjectConfig) {
//     this.baseUrl = config.rallyBaseUrl;
//     this.client = axios.create({
//       baseURL: this.baseUrl,
//       headers: {
//         ZSESSIONID: config.rallyApiKey,
//         "Content-Type": "application/json",
//       },
//       timeout: 15000,
//     });
//   }

//   /**
//    * Extract Rally formatted ID from a URL or plain ID string
//    * Supports: https://rally1.rallydev.com/#/...?detail=/userstory/12345
//    *           US12345, DE12345, TA12345, TC12345
//    */
//   parseTicketId(input: string): { type: string; formattedId: string } | null {
//     // URL format: extract formattedId from path or query
//     const urlMatch = input.match(/\/(userstory|defect|task|testcase)\/(\d+)/i);
//     if (urlMatch) {
//       const typeMap: Record<string, string> = {
//         userstory: "HierarchicalRequirement",
//         defect: "Defect",
//         task: "Task",
//         testcase: "TestCase",
//       };
//       return {
//         type: typeMap[urlMatch[1].toLowerCase()] || "HierarchicalRequirement",
//         formattedId: urlMatch[2],
//       };
//     }

//     // FormattedID format: US12345, DE12345, etc.
//     const idMatch = input.match(/^(US|DE|TA|TC|F)(\d+)$/i);
//     if (idMatch) {
//       const typeMap: Record<string, string> = {
//         US: "HierarchicalRequirement",
//         DE: "Defect",
//         TA: "Task",
//         TC: "TestCase",
//         F: "Feature",
//       };
//       return {
//         type: typeMap[idMatch[1].toUpperCase()],
//         formattedId: idMatch[0].toUpperCase(),
//       };
//     }

//     return null;
//   }

//   async fetchTicket(input: string): Promise<RallyTicket> {
//     const parsed = this.parseTicketId(input);
//     if (!parsed) throw new Error(`Cannot parse Rally ticket ID from: "${input}"`);

//     const endpoint = this.getEndpoint(parsed.type);

//     // Query by FormattedID or by OID
//     const query = parsed.formattedId.match(/^\d+$/)
//       ? `(ObjectID = ${parsed.formattedId})`
//       : `(FormattedID = "${parsed.formattedId}")`;

//     const response = await this.client.get(`/${endpoint}`, {
//       params: {
//         query,
//         fetch:
//           "FormattedID,Name,Description,Notes,AcceptanceCriteria,Tags,ScheduleState,Owner,Project,Attachments,TestCases",
//         pagesize: 1,
//       },
//     });

//     const results = response.data?.QueryResult?.Results;
//     if (!results || results.length === 0) {
//       throw new Error(`Rally ticket not found: ${parsed.formattedId}`);
//     }

//     return this.mapToTicket(results[0]);
//   }

//   private getEndpoint(type: string): string {
//     const endpoints: Record<string, string> = {
//       HierarchicalRequirement: "hierarchicalrequirement",
//       Defect: "defect",
//       Task: "task",
//       TestCase: "testcase",
//       Feature: "portfolioitem/feature",
//     };
//     return endpoints[type] || "hierarchicalrequirement";
//   }

//   private mapToTicket(raw: Record<string, unknown>): RallyTicket {
//     const stripHtml = (html: string | null | undefined): string => {
//       if (!html) return "";
//       return html
//         .replace(/<[^>]+>/g, " ")
//         .replace(/&nbsp;/g, " ")
//         .replace(/&amp;/g, "&")
//         .replace(/&lt;/g, "<")
//         .replace(/&gt;/g, ">")
//         .replace(/\s+/g, " ")
//         .trim();
//     };

//     const extractTestCases = (raw: Record<string, unknown>): string[] => {
//       const notes = stripHtml(raw.Notes as string);
//       const lines = notes.split("\n").filter((l) => l.trim());
//       return lines.filter(
//         (l) =>
//           l.match(/^(\d+\.|[-•*]|TC\d+)/i) ||
//           l.toLowerCase().includes("verify") ||
//           l.toLowerCase().includes("should") ||
//           l.toLowerCase().includes("given") ||
//           l.toLowerCase().includes("when") ||
//           l.toLowerCase().includes("then")
//       );
//     };

//     const extractTags = (raw: Record<string, unknown>): string[] => {
//       const tagsObj = raw.Tags as { _tagsNameArray?: Array<{ Name: string }> };
//       if (!tagsObj?._tagsNameArray) return [];
//       return tagsObj._tagsNameArray.map((t) => t.Name);
//     };

//     return {
//       id: String(raw.ObjectID || ""),
//       formattedId: String(raw.FormattedID || ""),
//       name: String(raw.Name || ""),
//       description: stripHtml(raw.Description as string),
//       acceptanceCriteria: stripHtml(raw.AcceptanceCriteria as string),
//       testCases: extractTestCases(raw),
//       tags: extractTags(raw),
//       state: String(raw.ScheduleState || raw.State || ""),
//       owner: (raw.Owner as { _refObjectName?: string })?._refObjectName,
//       project: (raw.Project as { _refObjectName?: string })?._refObjectName,
//     };
//   }
// }

// // Mock client for development/testing without real Rally credentials
// export class MockRallyClient {
//   parseTicketId(input: string): { type: string; formattedId: string } | null {
//     const match = input.match(/(?:US|DE|TA|TC|F)?\d+/i);
//     return match ? { type: "HierarchicalRequirement", formattedId: match[0] } : null;
//   }

//   async fetchTicket(input: string): Promise<RallyTicket> {
//     // Returns a realistic mock ticket for testing
//     await new Promise((r) => setTimeout(r, 300));
//     return {
//       id: "12345",
//       formattedId: "US12345",
//       name: "User Login with MFA",
//       description:
//         "As a registered user, I want to log in with multi-factor authentication so that my account is more secure.",
//       acceptanceCriteria: `
//         1. User can enter email and password on the login page
//         2. After valid credentials, user is prompted for MFA code
//         3. User receives MFA code via email or authenticator app
//         4. Entering correct MFA code redirects user to dashboard
//         5. Entering incorrect MFA code shows an error message
//         6. After 3 failed MFA attempts, account is temporarily locked
//         7. User can request a new MFA code if the original expires
//       `,
//       testCases: [
//         "Verify login form displays email and password fields",
//         "Verify MFA prompt appears after valid credentials",
//         "Verify correct MFA code grants dashboard access",
//         "Verify incorrect MFA code shows error",
//         "Verify account lockout after 3 failed attempts",
//       ],
//       tags: ["authentication", "security", "mfa"],
//       state: "In-Progress",
//       owner: "John Doe",
//       project: "Core Platform",
//     };
//   }
// }
