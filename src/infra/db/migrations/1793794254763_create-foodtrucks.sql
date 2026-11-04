-- Up Migration

CREATE TABLE foodtrucks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO foodtrucks (name) VALUES ('Foodtruck');

-- Down Migration

DROP TABLE foodtrucks;
