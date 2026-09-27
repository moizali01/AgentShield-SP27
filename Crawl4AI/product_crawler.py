import asyncio
import os
from pydantic import BaseModel, Field
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, LLMConfig
from crawl4ai.extraction_strategy import LLMExtractionStrategy

from dotenv import load_dotenv

load_dotenv()  

# 1. Define the schema for the product data
class Product(BaseModel):
    name: str = Field(..., description="Name of the product")
    price: str = Field(..., description="Price of the product, including currency symbol")
    features: list[str] = Field(default=[], description="List of key product features or specs")
    rating: str = Field(default=None, description="Product rating if available")

async def extract_product_info():
    # 2. Configure the LLM
    llm_config = LLMConfig(
        provider="gemini/gemini-3-flash-preview",  
        api_token=os.getenv("GEMINI_API_KEY")
    )

    # 3. Define the Extraction Strategy
    strategy = LLMExtractionStrategy(
        llm_config=llm_config,
        schema=Product.model_json_schema(),
        instruction="""You are an expert data scraper. Extract the main product details from this page. Specifically, locate the product's name, its price (must include the currency symbol), a list of its key features or specifications, and the customer rating. If any of this information is missing from the page, do not guess or hallucinate; leave the field null or empty.""",
        extra_args={
            "extra_body": {"reasoning": {"enabled": True}}
        }
    )

    # 4. Configure the Crawler
    run_config = CrawlerRunConfig(
        extraction_strategy=strategy,
        cache_mode="BYPASS"  # Bypass cache to ensure fresh extraction
    )

    # 5. Run the Crawl
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(
            url = "https://example.com",
            config=run_config
        )

        if result.success:
            print("--- Extracted Data ---")
            print(result.extracted_content)
        else:
            print(f"Error: {result.error_message}")

if __name__ == "__main__":
    asyncio.run(extract_product_info())