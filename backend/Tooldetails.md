# Kapruka Tools Reference

A concise reference for the Kapruka helper tools used in this project. Each tool section contains a short description, arguments, return schema, and example usage.

## Table of Contents

- [kapruka_list_categories](#kapruka_list_categories)
- [kapruka_search_products](#kapruka_search_products)
- [kapruka_get_product](#kapruka_get_product)
- [kapruka_list_delivery_cities](#kapruka_list_delivery_cities)
- [kapruka_check_delivery](#kapruka_check_delivery)
- [kapruka_create_order](#kapruka_create_order)
- [kapruka_track_order](#kapruka_track_order)

---

### kapruka_list_categories

List top-level Kapruka product categories by name with browse URLs.

- Purpose: Return category names (usable as the `category` filter) and public landing URLs.
- Read-only: Yes
- Destructive: No

Arguments:

- `params` (object):
  - `depth` (int): Sub-category levels to include, 1 or 2 (default 1)
  - `response_format` (str): `'markdown'` (default) or `'json'`

Return (markdown / json):

- `categories`: list of objects with `name`, `url`, and optional `children`.

Example (markdown):

```
## Kapruka Categories

- [Automobile](https://www.kapruka.com/online/automobile)
- [Ayurvedic](https://www.kapruka.com/online/ayurvedic)
...
```

---

### kapruka_search_products

Search for products on Kapruka.com by keyword, with optional category filter and pagination.

- Purpose: Return ranked products with price, stock, image, and URL. Supports cursor-based pagination (max 3 pages per query).
- Read-only: Yes

Arguments:

- `params` (object):
  - `q` (str, min 3 chars): query
  - `category` (str | null): optional category filter
  - `limit` (int): 1–50 (default 10)
  - `cursor` (str | null): pagination cursor
  - `currency` (str): `LKR` (default), `USD`, `GBP`, `AUD`, `CAD`, `EUR`
  - `min_price`, `max_price` (float | null)
  - `in_stock_only` (bool)
  - `sort` (str): `'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'bestseller'`
  - `include_stubs` (bool)
  - `response_format` (str): `'markdown'` or `'json'`

Return schema (summary):

```
{
  "results": [ { id, name, summary, price: {amount,currency}, in_stock, image_url, category, url } ],
  "next_cursor": str|null,
  "applied_filters": {...}
}
```

Example (search `roses`, markdown):

```
## Kapruka search: "roses"
Showing 9 results (LKR)

1. 6 Red Rose Bouquet With Elegant Wrapping — LKR 5,210
   [View product](https://www.kapruka.com/buyonline/6-red-rose-bouquet-with-elegan/kid/flowers00t2075)
...
```

---

### kapruka_get_product

Fetch full details for a single Kapruka product by its product ID.

- Purpose: Return detailed product info (description, images, variants, shipping).
- Read-only: Yes

Arguments:

- `params` (object):
  - `product_id` (str): e.g. `cake00ka002034`
  - `currency` (str): `LKR` (default) or others
  - `type` (str | null): optional type hint
  - `response_format`: `'markdown'` or `'json'`

Return schema (summary):

```
{
  id, name, description, summary,
  price: {amount, currency}, compare_at_price | null,
  in_stock: bool, stock_level: "low|medium|high",
  category: {id,name,slug,path}, variants: [...], images: [...], attributes: {...}, shipping: {...}, url
}
```

Example (ID `FLOWERS00T1384`):

```
## Love Me Tender — Nine Red Rose Bouquet
ID: FLOWERS00T1384
Price: LKR 5,550
Stock: In stock (low)
[View on Kapruka](https://www.kapruka.com/buyonline/love-me-tender-nine-red-rose-b/kid/flowers00t1384)
```

---

### kapruka_list_delivery_cities

List or search Sri Lankan cities Kapruka delivers to.

- Purpose: Return canonical city names and aliases for delivery checks.
- Read-only: Yes

Arguments:

- `params` (object):
  - `query` (str | null): partial match
  - `limit` (int): 1–50 (default 25)
  - `response_format` (str): `'markdown'` or `'json'`

Return (summary):

```
{
  "cities": [ { "name": str, "aliases": [str] } ],
  "total_matched": int,
  "showing": int
}
```

Example (first 25 cities):

```
## Kapruka delivery cities (25 of 332 total)
- Agalawatta (aliases: agalawatha)
- Agunukolapelassa (aliases: anguna)
...
```

---

### kapruka_check_delivery

Check whether Kapruka can deliver to a given city/date and the flat rate.

- Purpose: Return availability and flat delivery rate for a city and date. Adds perishable warning when applicable.

Arguments:

- `params` (object):
  - `city` (str): canonical city name (required)
  - `delivery_date` (str | null): `YYYY-MM-DD` (defaults to today)
  - `product_id` (str | null): optional (triggers perishable warning)
  - `response_format`: `'markdown'` or `'json'`

Return (summary):

```
{
  city, now (ISO timestamp), checked_date (YYYY-MM-DD), available (bool),
  rate: number (LKR), currency: "LKR",
  reason: str|null, next_available_date: str|null, perishable_warning: str|null
}
```

Example:

```
## Delivery to Matale on 2026-06-04
Available — flat rate LKR 1,075
```

---

### kapruka_create_order

Create a guest-checkout order and return a click-to-pay link. (Free-tier limits apply.)

- Purpose: Build an order, reserve prices, and return a checkout URL (valid 60 minutes).
- Read-only: No (creates order token)

Arguments (summary):

- `params` (object):
  - `cart` (list): 1–30 items, each with `product_id`, `quantity`, optional `icing_text`
  - `recipient`: name + phone (E.164 or local format)
  - `delivery`: address, city (must be deliverable), `location_type`, `date`, optional `instructions`
  - `sender`: name + `anonymous` flag
  - `gift_message` (str|null)
  - `currency` (str)
  - `response_format` (str)

Return schema (summary):

```
{
  checkout_url: str,
  order_ref: str,
  summary: { items_total, delivery_fee, addons_total, grand_total, currency },
  expires_at: ISO timestamp
}
```

Common error codes: `empty_cart`, `missing_field`, `past_delivery_date`, `product_not_found`, `product_out_of_stock`, `city_not_deliverable`, `date_not_deliverable`.

---

### kapruka_track_order

Lookup the status and delivery progress for an existing Kapruka order by order number.

- Purpose: Return order status, timeline, recipient/delivery details, and cart contents.
- Read-only: Yes

Arguments:

- `params` (object):
  - `order_number` (str): Kapruka order number (required)
  - `response_format` (str): `'markdown'` or `'json'`

Return schema (summary):

```
{
  order_number, pnref, status, status_display, order_date, delivery_date,
  shipped_date|null, amount, payment_method, recipient: {...}, progress: [...], items: [...]
}
```

Example (output schema):

```
{ "result": "<human-readable tracking info>" }
```

---

If you'd like a different organization (e.g., per-category files or a machine-readable JSON schema file), tell me how you want it and I will split this into multiple artifacts.
***kapruka_list_categories***

List top-level Kapruka product categories by name with browse URLs.

    Returns category names (usable as the `category` filter on kapruka_search_products)
    plus the public Kapruka.com URL for each category landing page — useful for shopping
    agents that want to send users directly to a category to browse. Internal IDs and
    product counts are not exposed. Results are cached for 30 minutes server-side.

    Args:
        params (ListCategoriesInput):
            - depth (int): Sub-category levels to include, 1 or 2 (default 1)
            - response_format (str): 'markdown' (default) or 'json'

    Returns:
        str: Category tree in the requested format.

        JSON schema:
        {
          "categories": [
            {
              "name": str,
              "url": str,                  # kapruka.com category landing page
              "children": [{"name": str, "url": str, "children": [...]}]
            }
          ]
        }

        Error: "Error: <message>" on failure.
    

✓ Read-only
✗ Destruct

Input - {
  "params": {
    "depth": 1,
    "response_format": "markdown"
  }
}

Output - 

   Structured -
   {
  "result": "## Kapruka Categories\n\n- [Automobile](https://www.kapruka.com/online/automobile)\n- [Ayurvedic](https://www.kapruka.com/online/ayurvedic)\n- [Bicycle](https://www.kapruka.com/online/bicycles)\n- [Books](https://www.kapruka.com/online/books)\n- [Chocolates](https://www.kapruka.com/online/chocolates)\n- [Clothing](https://www.kapruka.com/online/clothing)\n- [combopack](https://www.kapruka.com/online/combogifts)\n- [Cosmetics](https://www.kapruka.com/online/cosmetics)\n- [Curd](https://www.kapruka.com/online/curd)\n- [Electronic](https://www.kapruka.com/online/electronics)\n- [Fashion](https://www.kapruka.com/online/fashion)\n- [Fruits](https://www.kapruka.com/online/fruitbaskets)\n- [Giftcert](https://www.kapruka.com/online/giftvouchers)\n- [Giftset](https://www.kapruka.com/online/giftset)\n- [GreetingCards](https://www.kapruka.com/online/greetingcards)\n- [Grocery](https://www.kapruka.com/online/grocery)\n- [Household](https://www.kapruka.com/online/home_lifestyle)\n- [Jewellery](https://www.kapruka.com/online/jewellery)\n- [KidsToys](https://www.kapruka.com/online/toys)\n- [Liquor](https://www.kapruka.com/online/liquor)\n- [BabyItems](https://www.kapruka.com/online/baby)\n- [party](https://www.kapruka.com/online/party)\n- [Perfumes](https://www.kapruka.com/online/perfumes)\n- [Pet](https://www.kapruka.com/online/pet)\n- [Pharmacy](https://www.kapruka.com/online/pharmacy)\n- [pirikara](https://www.kapruka.com/online/pirikara)\n- [Childrens](https://www.kapruka.com/online/childrens)\n- [Schoolpride](https://www.kapruka.com/online/schoolpride)\n- [Softtoy](https://www.kapruka.com/online/softtoy)\n- [Sports](https://www.kapruka.com/online/sports)\n- [Vegetables](https://www.kapruka.com/online/vegetables)\n- [Adult Products](https://www.kapruka.com/online/intimate_essentials)\n- [thaipongle](https://www.kapruka.com/online/thaipongle)\n- [teachersday](https://www.kapruka.com/online/teachersday)\n- [samedaydelivery](https://www.kapruka.com/online/samedaydelivery)\n- [bestsellers](https://www.kapruka.com/online/bestsellers)\n- [diwali](https://www.kapruka.com/online/diwali)\n- [newadditions](https://www.kapruka.com/online/newadditions)\n- [graduation](https://www.kapruka.com/online/graduation)\n- [valentine](https://www.kapruka.com/online/valentine)\n- [newyear_january](https://www.kapruka.com/online/newyear_january)\n- [fathersday](https://www.kapruka.com/online/fathersday)\n- [childrensday](https://www.kapruka.com/online/childrensday)\n- [christmas](https://www.kapruka.com/online/christmas)\n- [anniversary](https://www.kapruka.com/online/anniversary)\n- [birthday](https://www.kapruka.com/online/birthday)\n- [bridetobe](https://www.kapruka.com/online/bridetobe)\n- [corporate](https://www.kapruka.com/online/corporate)\n- [lover](https://www.kapruka.com/online/lover)\n- [momtobe](https://www.kapruka.com/online/momtobe)\n- [mother](https://www.kapruka.com/online/mother)\n- [sympathies](https://www.kapruka.com/online/sympathies)\n- [uniquegifts](https://www.kapruka.com/online/uniquegifts)\n- [wedding](https://www.kapruka.com/online/wedding)\n- [womenday](https://www.kapruka.com/online/womenday)\n- [youandme](https://www.kapruka.com/online/youandme)\n- [household](https://www.kapruka.com/online/household)\n- [ornaments](https://www.kapruka.com/online/ornaments)\n- [promotions](https://www.kapruka.com/online/promotions)\n- [cakes](https://www.kapruka.com/online/cakes)\n- [flowers](https://www.kapruka.com/online/flowers)\n- [Personalized Gifts](https://www.kapruka.com/online/personalized_gifts)\n- [halloween](https://www.kapruka.com/online/halloween)\n- [Services](https://www.kapruka.com/online/services)"
}

 unstructured -
 ## Kapruka Categories

- [Automobile](https://www.kapruka.com/online/automobile)
- [Ayurvedic](https://www.kapruka.com/online/ayurvedic)
- [Bicycle](https://www.kapruka.com/online/bicycles)
- [Books](https://www.kapruka.com/online/books)
- [Chocolates](https://www.kapruka.com/online/chocolates)
- [Clothing](https://www.kapruka.com/online/clothing)
- [combopack](https://www.kapruka.com/online/combogifts)
- [Cosmetics](https://www.kapruka.com/online/cosmetics)
- [Curd](https://www.kapruka.com/online/curd)
- [Electronic](https://www.kapruka.com/online/electronics)
- [Fashion](https://www.kapruka.com/online/fashion)
- [Fruits](https://www.kapruka.com/online/fruitbaskets)
- [Giftcert](https://www.kapruka.com/online/giftvouchers)
- [Giftset](https://www.kapruka.com/online/giftset)
- [GreetingCards](https://www.kapruka.com/online/greetingcards)
- [Grocery](https://www.kapruka.com/online/grocery)
- [Household](https://www.kapruka.com/online/home_lifestyle)
- [Jewellery](https://www.kapruka.com/online/jewellery)
- [KidsToys](https://www.kapruka.com/online/toys)
- [Liquor](https://www.kapruka.com/online/liquor)
- [BabyItems](https://www.kapruka.com/online/baby)
- [party](https://www.kapruka.com/online/party)
- [Perfumes](https://www.kapruka.com/online/perfumes)
- [Pet](https://www.kapruka.com/online/pet)
- [Pharmacy](https://www.kapruka.com/online/pharmacy)
- [pirikara](https://www.kapruka.com/online/pirikara)
- [Childrens](https://www.kapruka.com/online/childrens)
- [Schoolpride](https://www.kapruka.com/online/schoolpride)
- [Softtoy](https://www.kapruka.com/online/softtoy)
- [Sports](https://www.kapruka.com/online/sports)
- [Vegetables](https://www.kapruka.com/online/vegetables)
- [Adult Products](https://www.kapruka.com/online/intimate_essentials)
- [thaipongle](https://www.kapruka.com/online/thaipongle)
- [teachersday](https://www.kapruka.com/online/teachersday)
- [samedaydelivery](https://www.kapruka.com/online/samedaydelivery)
- [bestsellers](https://www.kapruka.com/online/bestsellers)
- [diwali](https://www.kapruka.com/online/diwali)
- [newadditions](https://www.kapruka.com/online/newadditions)
- [graduation](https://www.kapruka.com/online/graduation)
- [valentine](https://www.kapruka.com/online/valentine)
- [newyear_january](https://www.kapruka.com/online/newyear_january)
- [fathersday](https://www.kapruka.com/online/fathersday)
- [childrensday](https://www.kapruka.com/online/childrensday)
- [christmas](https://www.kapruka.com/online/christmas)
- [anniversary](https://www.kapruka.com/online/anniversary)
- [birthday](https://www.kapruka.com/online/birthday)
- [bridetobe](https://www.kapruka.com/online/bridetobe)
- [corporate](https://www.kapruka.com/online/corporate)
- [lover](https://www.kapruka.com/online/lover)
- [momtobe](https://www.kapruka.com/online/momtobe)
- [mother](https://www.kapruka.com/online/mother)
- [sympathies](https://www.kapruka.com/online/sympathies)
- [uniquegifts](https://www.kapruka.com/online/uniquegifts)
- [wedding](https://www.kapruka.com/online/wedding)
- [womenday](https://www.kapruka.com/online/womenday)
- [youandme](https://www.kapruka.com/online/youandme)
- [household](https://www.kapruka.com/online/household)
- [ornaments](https://www.kapruka.com/online/ornaments)
- [promotions](https://www.kapruka.com/online/promotions)
- [cakes](https://www.kapruka.com/online/cakes)
- [flowers](https://www.kapruka.com/online/flowers)
- [Personalized Gifts](https://www.kapruka.com/online/personalized_gifts)
- [halloween](https://www.kapruka.com/online/halloween)
- [Services](https://www.kapruka.com/online/services)

-----------------------------------------------------

