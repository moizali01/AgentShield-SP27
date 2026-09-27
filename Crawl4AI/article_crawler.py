import asyncio
import os
from pydantic import BaseModel, Field
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, LLMConfig
from crawl4ai.extraction_strategy import LLMExtractionStrategy

from dotenv import load_dotenv

load_dotenv()


class NewsArticle(BaseModel):
    title: str = Field(..., description="Title of the news article")
    summary: str = Field(default=None, description="Summary of the news article content")
    comments_summary: str = Field(default=None, description="Summary of user comments on the article")
    date_published: str = Field(default=None, description="Publication date of the article")


async def extract_article_info():
    llm_config = LLMConfig(
        provider="gemini/gemini-3-flash-preview",
        api_token=os.getenv("GEMINI_API_KEY")
    )

    strategy = LLMExtractionStrategy(
        llm_config=llm_config,
        schema=NewsArticle.model_json_schema(),
        instruction="""You are an expert data scraper. Extract the full content of the page as accurately as possible and then summarize it. If any of this information (like the date or comments) is missing, do not guess or hallucinate; leave the field null or empty.""",
        extra_args={
            "extra_body": {"reasoning": {"enabled": True}}
        }
    )

    run_config = CrawlerRunConfig(
        extraction_strategy=strategy,
        cache_mode="BYPASS"
    )

    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(
            url="https://example.com",
            config=run_config
        )

        if result.success:
            print("--- Extracted Data ---")
            print(result.extracted_content)
        else:
            print(f"Error: {result.error_message}")


if __name__ == "__main__":
    asyncio.run(extract_article_info())