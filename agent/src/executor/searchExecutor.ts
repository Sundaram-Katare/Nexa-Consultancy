import { browserManager } from "../browser/browserManager";
import { adapterRegistry } from "../adapters";
import {
  getSearchTaskById,
  updateSearchTaskProgress,
  insertSearchHistory,
  insertPendingDocument,
} from "../db/queries/searchTasks";
import { saveCheckpoint } from "../pipeline/checkpointService";
import { withRetry, PipelineExecutionError } from "../errors";
import { concurrencyController } from "../pipeline/concurrencyController";

export interface ExecutionResult {
  searchTaskId: string;
  jobId: string;
  queryText: string;
  pagesCrawled: number;
  totalDocumentsFound: number;
  newDocumentsInserted: number;
  duplicatesSkipped: number;
  finalStatus: string;
  finalPage: number;
}

/**
 * Executes a single search task through the target adapter with deep pagination,
 * incremental checkpointing, deduplicated document ingestion, and centralized retry policy.
 */
export async function runTask(
  searchTaskId: string,
  maxPages = 20
): Promise<ExecutionResult> {
  // 1. Load task record from database
  const task = await getSearchTaskById(searchTaskId);
  if (!task) {
    throw new Error(`Search task with ID '${searchTaskId}' was not found.`);
  }

  console.log(
    `[EXECUTOR] Starting search task ${task.id} (${task.source_name}): "${task.query_text}" (Starting at Page ${task.page})`
  );

  // 2. Mark task as RUNNING
  await updateSearchTaskProgress(task.id, task.page, "RUNNING");

  // 3. Resolve source adapter
  const adapter = adapterRegistry.get(task.source_name);

  // 4. Acquire concurrency slot & create isolated browser session
  let sessionId = "";
  let currentPage = task.page || 1;
  let pagesCrawled = 0;
  let totalDocumentsFound = 0;
  let newDocumentsInserted = 0;
  let duplicatesSkipped = 0;

  await concurrencyController.acquire(task.source_name);

  try {
    sessionId = await browserManager.newSession();
    const page = browserManager.getPage(sessionId);
    const session = { id: sessionId, page };

    // 5. Pagination Loop
    while (currentPage <= maxPages) {
      console.log(`[EXECUTOR] Task ${task.id} executing page ${currentPage}/${maxPages}...`);

      const resultPage = await withRetry(
        async () => {
          if (currentPage === 1) {
            return await adapter.search(session, task.query_text);
          } else {
            return await adapter.getNextPage(session, currentPage - 1);
          }
        },
        "NAVIGATION_TIMEOUT",
        {
          jobId: task.job_id,
          searchTaskId: task.id,
          action: `search_page_${currentPage}`,
        }
      );

      pagesCrawled++;

      // Check for empty or exhausted results
      if (!resultPage || resultPage.results.length === 0) {
        console.log(`[EXECUTOR] No results on page ${currentPage}. Search exhausted.`);
        await insertSearchHistory(task.id, 0, {
          page: currentPage,
          rawResultCount: 0,
          hasNextPage: false,
        });
        await updateSearchTaskProgress(task.id, currentPage, "RUNNING");
        break;
      }

      // Record search history for this page
      await insertSearchHistory(task.id, resultPage.results.length, {
        page: currentPage,
        rawResultCount: resultPage.rawResultCount,
        hasNextPage: resultPage.hasNextPage,
      });

      // Ingest document candidates with deduplication
      for (const item of resultPage.results) {
        totalDocumentsFound++;
        const ingestRes = await insertPendingDocument({
          sourceId: task.source_id,
          sourceDocId: item.sourceDocumentId,
          canonicalUrl: item.canonicalUrl,
          title: item.titleRaw,
          countryId: task.country_id,
          institution: task.institution,
        });

        if (ingestRes.inserted) {
          newDocumentsInserted++;
        } else {
          duplicatesSkipped++;
        }
      }

      // Incrementally persist progress and checkpoint after every page
      await updateSearchTaskProgress(task.id, currentPage, "RUNNING");
      await saveCheckpoint(
        task.job_id,
        task.id,
        currentPage,
        totalDocumentsFound,
        "RUNNING",
        "SEARCH"
      );

      // Check if site has more pages
      if (!resultPage.hasNextPage) {
        console.log(`[EXECUTOR] Target site indicates no further pages. Pagination finished.`);
        break;
      }

      currentPage++;
    }

    // 6. Mark task COMPLETED
    await updateSearchTaskProgress(task.id, currentPage, "COMPLETED");
    await saveCheckpoint(
      task.job_id,
      task.id,
      currentPage,
      totalDocumentsFound,
      "COMPLETED",
      "SEARCH"
    );

    console.log(
      `[EXECUTOR] Task ${task.id} COMPLETED: ${pagesCrawled} pages crawled, ${totalDocumentsFound} docs found (${newDocumentsInserted} new, ${duplicatesSkipped} duplicates).`
    );

    return {
      searchTaskId: task.id,
      jobId: task.job_id,
      queryText: task.query_text,
      pagesCrawled,
      totalDocumentsFound,
      newDocumentsInserted,
      duplicatesSkipped,
      finalStatus: "COMPLETED",
      finalPage: currentPage,
    };
  } catch (err: any) {
    console.error(`[EXECUTOR] Task ${task.id} failed after retries exhausted:`, err.message);

    let finalStatus: "BLOCKED" | "FAILED" = "FAILED";
    if (
      err instanceof PipelineExecutionError &&
      (err.category === "RATE_LIMITED" ||
        err.category === "CAPTCHA_DETECTED" ||
        err.category === "LOGIN_REQUIRED" ||
        err.category === "ACCESS_DENIED")
    ) {
      finalStatus = "BLOCKED";
    }

    await updateSearchTaskProgress(task.id, currentPage, finalStatus);
    throw err;
  } finally {
    if (sessionId) {
      await browserManager.closeSession(sessionId);
    }
    concurrencyController.release(task.source_name);
  }
}
