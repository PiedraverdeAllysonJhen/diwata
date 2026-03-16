-- DW.010.003 catalog seed: 20 books + metadata + relations + copies

alter table public.books
  add column if not exists publication_date date;

with seed_categories(name) as (
  values
    ('Computer'),
    ('Technology'),
    ('Agriculture'),
    ('Chemistry'),
    ('Biology'),
    ('Marine Science'),
    ('General Science'),
    ('Mathematics'),
    ('Engineering'),
    ('Machine Learning')
)
insert into public.categories (name)
select name
from seed_categories
on conflict (name) do nothing;

with seed_books(
  isbn,
  title,
  subtitle,
  description,
  publisher,
  publication_year,
  language,
  cover_image_url,
  total_copies,
  available_copies,
  tags,
  author_name
) as (
  values
    ('9780132350884','Clean Code','A Handbook of Agile Software Craftsmanship','A practical guide for writing readable, maintainable, and testable software systems.','Prentice Hall',2008,'English','https://picsum.photos/seed/clean-code/420/620',6,4,array['computer','software engineering','clean code'],'Robert C. Martin'),
    ('9780133594140','Computer Networking','A Top-Down Approach','Foundational networking concepts, internet protocols, and modern network design.','Pearson',2016,'English','https://picsum.photos/seed/networking/420/620',5,3,array['computer','technology','network'],'James F. Kurose'),
    ('9780262046305','Introduction to Algorithms','Fourth Edition','Comprehensive algorithm design and analysis reference for computing and mathematics.','MIT Press',2022,'English','https://picsum.photos/seed/algorithms/420/620',7,4,array['computer','mathematics','algorithms'],'Thomas H. Cormen'),
    ('9780134610993','Artificial Intelligence','A Modern Approach','Core principles, techniques, and applications of artificial intelligence systems.','Pearson',2020,'English','https://picsum.photos/seed/aima/420/620',4,2,array['machine learning','ai','computer'],'Stuart Russell'),
    ('9781098125974','Hands-On Machine Learning','With Scikit-Learn, Keras, and TensorFlow','Applied machine learning workflows for real-world data and predictive modeling.','O''Reilly Media',2022,'English','https://picsum.photos/seed/hands-on-ml/420/620',6,4,array['machine learning','python','technology'],'Aurelien Geron'),
    ('9780135957059','The Pragmatic Programmer','Your Journey To Mastery','Practical habits and engineering principles for modern software professionals.','Addison-Wesley',2019,'English','https://picsum.photos/seed/pragmatic/420/620',5,3,array['computer','engineering','programming'],'David Thomas'),
    ('9781119800361','Operating System Concepts','Tenth Edition','Processes, memory, file systems, and security fundamentals for operating systems.','Wiley',2018,'English','https://picsum.photos/seed/os-concepts/420/620',5,2,array['computer','technology','operating systems'],'Abraham Silberschatz'),
    ('9780134814988','Engineering Mechanics: Statics','SI Edition','Statics principles for structural analysis and engineering problem solving.','Pearson',2017,'English','https://picsum.photos/seed/statics/420/620',6,3,array['engineering','mathematics','mechanics'],'R. C. Hibbeler'),
    ('9781259822674','Thermodynamics: An Engineering Approach','Ninth Edition','Applied thermodynamics concepts for energy systems and engineering applications.','McGraw-Hill Education',2018,'English','https://picsum.photos/seed/thermodynamics/420/620',6,3,array['engineering','science','thermodynamics'],'Yunus A. Cengel'),
    ('9780872634923','Precision Machine Design','Theory and Practice','Design methods for high-accuracy machines used in advanced engineering systems.','Society of Manufacturing Engineers',1992,'English','https://picsum.photos/seed/machine-design/420/620',4,2,array['engineering','machine','design'],'Alexander H. Slocum'),
    ('9780135188743','Campbell Biology','Twelfth Edition','Comprehensive biology text covering cellular, molecular, organismal, and ecological systems.','Pearson',2020,'English','https://picsum.photos/seed/campbell-biology/420/620',6,3,array['biology','science','life science'],'Lisa A. Urry'),
    ('9781319228002','Lehninger Principles of Biochemistry','Eighth Edition','Biochemistry fundamentals including molecular structure, metabolism, and regulation.','W. H. Freeman',2021,'English','https://picsum.photos/seed/lehninger/420/620',5,2,array['biology','chemistry','biochemistry'],'David L. Nelson'),
    ('9780199270293','Organic Chemistry','Second Edition','Mechanistic organic chemistry with synthesis, structure, and reactivity principles.','Oxford University Press',2012,'English','https://picsum.photos/seed/organic-chem/420/620',5,3,array['chemistry','organic chemistry','science'],'Jonathan Clayden'),
    ('9780132931281','General Chemistry','Principles and Modern Applications','General chemistry framework for atomic structure, bonding, reactions, and kinetics.','Pearson',2014,'English','https://picsum.photos/seed/general-chem/420/620',5,2,array['chemistry','science','laboratory'],'Ralph H. Petrucci'),
    ('9780321909107','Conceptual Physics','Twelfth Edition','Concept-first introduction to physics with real-world examples and problem solving.','Pearson',2014,'English','https://picsum.photos/seed/conceptual-physics/420/620',6,4,array['science','physics','mathematics'],'Paul G. Hewitt'),
    ('9780078024146','Marine Biology','Ninth Edition','Marine ecosystems, biodiversity, and ocean processes for marine science learners.','McGraw-Hill Education',2015,'English','https://picsum.photos/seed/marine-biology/420/620',5,3,array['marine','biology','science'],'Peter Castro'),
    ('9780134073545','Essentials of Oceanography','Twelfth Edition','Ocean structure, circulation, marine geology, and human-ocean interactions.','Pearson',2018,'English','https://picsum.photos/seed/oceanography/420/620',4,2,array['marine science','oceanography','science'],'Alan P. Trujillo'),
    ('9780190099763','Principles of Agronomy','Sustainable Crop Production','Agronomic foundations for crop systems, soil management, and sustainable practices.','Oxford University Press',2020,'English','https://picsum.photos/seed/agronomy/420/620',6,4,array['agriculture','science','crop production'],'Rattan Lal'),
    ('9780130278241','Soil Fertility and Fertilizers','An Introduction to Nutrient Management','Nutrient management and soil chemistry principles for modern agriculture.','Prentice Hall',2003,'English','https://picsum.photos/seed/soil-fertility/420/620',5,2,array['agriculture','chemistry','soil science'],'John L. Havlin'),
    ('9781032210476','Precision Agriculture','Technology and Data-Driven Crop Management','Technology-enabled farming systems using sensors, analytics, and machine intelligence.','CRC Press',2022,'English','https://picsum.photos/seed/precision-agri/420/620',4,3,array['agriculture','technology','machine learning'],'Qin Zhang')
),
insert_authors as (
  insert into public.authors (name)
  select distinct author_name
  from seed_books
  on conflict (name) do nothing
  returning id, name
)
insert into public.books (
  isbn,
  title,
  subtitle,
  description,
  publisher,
  publication_year,
  publication_date,
  language,
  cover_image_url,
  total_copies,
  available_copies,
  tags
)
select
  isbn,
  title,
  subtitle,
  description,
  publisher,
  publication_year,
  make_date(publication_year, 1, 1) as publication_date,
  language,
  cover_image_url,
  total_copies,
  available_copies,
  tags
from seed_books
on conflict (isbn) do update
set
  title = excluded.title,
  subtitle = excluded.subtitle,
  description = excluded.description,
  publisher = excluded.publisher,
  publication_year = excluded.publication_year,
  publication_date = excluded.publication_date,
  language = excluded.language,
  cover_image_url = excluded.cover_image_url,
  total_copies = excluded.total_copies,
  available_copies = excluded.available_copies,
  tags = excluded.tags,
  updated_at = timezone('utc', now());

with seed_books(isbn, author_name) as (
  values
    ('9780132350884','Robert C. Martin'),
    ('9780133594140','James F. Kurose'),
    ('9780262046305','Thomas H. Cormen'),
    ('9780134610993','Stuart Russell'),
    ('9781098125974','Aurelien Geron'),
    ('9780135957059','David Thomas'),
    ('9781119800361','Abraham Silberschatz'),
    ('9780134814988','R. C. Hibbeler'),
    ('9781259822674','Yunus A. Cengel'),
    ('9780872634923','Alexander H. Slocum'),
    ('9780135188743','Lisa A. Urry'),
    ('9781319228002','David L. Nelson'),
    ('9780199270293','Jonathan Clayden'),
    ('9780132931281','Ralph H. Petrucci'),
    ('9780321909107','Paul G. Hewitt'),
    ('9780078024146','Peter Castro'),
    ('9780134073545','Alan P. Trujillo'),
    ('9780190099763','Rattan Lal'),
    ('9780130278241','John L. Havlin'),
    ('9781032210476','Qin Zhang')
)
insert into public.book_authors (book_id, author_id)
select b.id, a.id
from seed_books sb
join public.books b on b.isbn = sb.isbn
join public.authors a on a.name = sb.author_name
on conflict (book_id, author_id) do nothing;

with seed_book_categories(isbn, category_name) as (
  values
    ('9780132350884','Computer'),
    ('9780132350884','Technology'),
    ('9780133594140','Computer'),
    ('9780133594140','Technology'),
    ('9780262046305','Computer'),
    ('9780262046305','Mathematics'),
    ('9780134610993','Machine Learning'),
    ('9780134610993','Computer'),
    ('9781098125974','Machine Learning'),
    ('9781098125974','Technology'),
    ('9780135957059','Computer'),
    ('9780135957059','Engineering'),
    ('9781119800361','Computer'),
    ('9781119800361','Technology'),
    ('9780134814988','Engineering'),
    ('9780134814988','Mathematics'),
    ('9781259822674','Engineering'),
    ('9781259822674','General Science'),
    ('9780872634923','Engineering'),
    ('9780872634923','Machine Learning'),
    ('9780135188743','Biology'),
    ('9780135188743','General Science'),
    ('9781319228002','Biology'),
    ('9781319228002','Chemistry'),
    ('9780199270293','Chemistry'),
    ('9780132931281','Chemistry'),
    ('9780132931281','General Science'),
    ('9780321909107','General Science'),
    ('9780321909107','Mathematics'),
    ('9780078024146','Marine Science'),
    ('9780078024146','Biology'),
    ('9780134073545','Marine Science'),
    ('9780134073545','General Science'),
    ('9780190099763','Agriculture'),
    ('9780190099763','General Science'),
    ('9780130278241','Agriculture'),
    ('9780130278241','Chemistry'),
    ('9781032210476','Agriculture'),
    ('9781032210476','Technology'),
    ('9781032210476','Machine Learning')
)
insert into public.book_categories (book_id, category_id)
select b.id, c.id
from seed_book_categories sbc
join public.books b on b.isbn = sbc.isbn
join public.categories c on c.name = sbc.category_name
on conflict (book_id, category_id) do nothing;

insert into public.book_copies (
  book_id,
  accession_number,
  barcode,
  shelf_location,
  status,
  acquired_at,
  notes
)
select
  b.id,
  format('AC-%s-%s', right(b.isbn, 6), lpad(gs::text, 2, '0')),
  format('BC-%s-%s', right(b.isbn, 8), lpad(gs::text, 2, '0')),
  'Learning Commons - Main Stacks',
  case
    when gs <= b.available_copies then 'available'::public.copy_status
    else 'reserved'::public.copy_status
  end,
  coalesce(b.publication_date, make_date(coalesce(b.publication_year, 2020), 1, 1)),
  'Seeded for DW.010.003 catalog metadata testing'
from public.books b
cross join generate_series(1, b.total_copies) as gs
where b.isbn in (
  '9780132350884','9780133594140','9780262046305','9780134610993','9781098125974',
  '9780135957059','9781119800361','9780134814988','9781259822674','9780872634923',
  '9780135188743','9781319228002','9780199270293','9780132931281','9780321909107',
  '9780078024146','9780134073545','9780190099763','9780130278241','9781032210476'
)
on conflict do nothing;
