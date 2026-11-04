-- Up Migration

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  foodtruck_id uuid NOT NULL REFERENCES foodtrucks (id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (foodtruck_id, name)
);

-- Down Migration

DROP TABLE categories;
