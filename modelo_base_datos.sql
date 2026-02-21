--
-- PostgreSQL database dump
--

\restrict Q2hNdhh7rBmsMcAOegrTi6Ml8hggY41qP4WSmwsGfpA1KKVKAa0XlX1e1abRBnG

-- Dumped from database version 16.11 (Ubuntu 16.11-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.11 (Ubuntu 16.11-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: brands; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.brands (
    id integer NOT NULL,
    name character varying(100) NOT NULL
);


ALTER TABLE public.brands OWNER TO torn;

--
-- Name: brands_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.brands_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.brands_id_seq OWNER TO torn;

--
-- Name: brands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.brands_id_seq OWNED BY public.brands.id;


--
-- Name: cafs; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.cafs (
    id integer NOT NULL,
    tipo_documento integer NOT NULL,
    folio_desde integer NOT NULL,
    folio_hasta integer NOT NULL,
    ultimo_folio_usado integer NOT NULL,
    xml_caf text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.cafs OWNER TO torn;

--
-- Name: COLUMN cafs.tipo_documento; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.cafs.tipo_documento IS '33=Factura, 34=Exenta, 39=Boleta, 61=NC';


--
-- Name: COLUMN cafs.xml_caf; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.cafs.xml_caf IS 'XML del CAF entregado por el SII';


--
-- Name: cafs_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.cafs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cafs_id_seq OWNER TO torn;

--
-- Name: cafs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.cafs_id_seq OWNED BY public.cafs.id;


--
-- Name: cash_sessions; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.cash_sessions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    start_time timestamp with time zone DEFAULT now(),
    end_time timestamp with time zone,
    start_amount numeric(15,2) NOT NULL,
    final_cash_system numeric(15,2),
    final_cash_declared numeric(15,2),
    difference numeric(15,2),
    status character varying(20)
);


ALTER TABLE public.cash_sessions OWNER TO torn;

--
-- Name: COLUMN cash_sessions.start_amount; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.cash_sessions.start_amount IS 'Monto de apertura';


--
-- Name: COLUMN cash_sessions.final_cash_system; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.cash_sessions.final_cash_system IS 'Efectivo esperado por ventas/retiros';


--
-- Name: COLUMN cash_sessions.final_cash_declared; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.cash_sessions.final_cash_declared IS 'Efectivo contado por cajero';


--
-- Name: COLUMN cash_sessions.difference; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.cash_sessions.difference IS 'Diferencia (Sobra/Falta)';


--
-- Name: COLUMN cash_sessions.status; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.cash_sessions.status IS 'OPEN | CLOSED';


--
-- Name: cash_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.cash_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cash_sessions_id_seq OWNER TO torn;

--
-- Name: cash_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.cash_sessions_id_seq OWNED BY public.cash_sessions.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    rut character varying(12) NOT NULL,
    razon_social character varying(200) NOT NULL,
    giro character varying(200),
    direccion character varying(300),
    comuna character varying(100),
    ciudad character varying(100),
    email character varying(150),
    current_balance numeric(15,2),
    is_active boolean,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone
);


ALTER TABLE public.customers OWNER TO torn;

--
-- Name: COLUMN customers.current_balance; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.customers.current_balance IS 'Saldo de Cuenta Corriente';


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customers_id_seq OWNER TO torn;

--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: dtes; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.dtes (
    id integer NOT NULL,
    sale_id integer NOT NULL,
    tipo_dte integer NOT NULL,
    folio integer NOT NULL,
    xml_content text,
    track_id character varying(50),
    estado_sii character varying(20),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone
);


ALTER TABLE public.dtes OWNER TO torn;

--
-- Name: COLUMN dtes.tipo_dte; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.dtes.tipo_dte IS '33=Factura, 34=Exenta, 61=NC, 56=ND';


--
-- Name: COLUMN dtes.xml_content; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.dtes.xml_content IS 'XML firmado del DTE';


--
-- Name: COLUMN dtes.track_id; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.dtes.track_id IS 'Track ID devuelto por el SII';


--
-- Name: COLUMN dtes.estado_sii; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.dtes.estado_sii IS 'pendiente|enviado|aceptado|rechazado';


--
-- Name: dtes_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.dtes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.dtes_id_seq OWNER TO torn;

--
-- Name: dtes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.dtes_id_seq OWNED BY public.dtes.id;


--
-- Name: issuers; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.issuers (
    id integer NOT NULL,
    rut character varying(12) NOT NULL,
    razon_social character varying(200) NOT NULL,
    giro character varying(200) NOT NULL,
    acteco character varying(10) NOT NULL,
    direccion character varying(300),
    comuna character varying(100),
    ciudad character varying(100),
    telefono character varying(20),
    email character varying(150),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone
);


ALTER TABLE public.issuers OWNER TO torn;

--
-- Name: COLUMN issuers.acteco; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.issuers.acteco IS 'Código de actividad económica SII';


--
-- Name: issuers_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.issuers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.issuers_id_seq OWNER TO torn;

--
-- Name: issuers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.issuers_id_seq OWNED BY public.issuers.id;


--
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.payment_methods (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(50) NOT NULL,
    is_active boolean
);


ALTER TABLE public.payment_methods OWNER TO torn;

--
-- Name: COLUMN payment_methods.code; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.payment_methods.code IS 'CASH, DEBIT, CREDIT, TRANSFER';


--
-- Name: payment_methods_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.payment_methods_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payment_methods_id_seq OWNER TO torn;

--
-- Name: payment_methods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.payment_methods_id_seq OWNED BY public.payment_methods.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.products (
    id integer NOT NULL,
    parent_id integer,
    codigo_interno character varying(50) NOT NULL,
    codigo_barras character varying(50),
    nombre character varying(200) NOT NULL,
    descripcion text,
    precio_neto numeric(15,2) NOT NULL,
    unidad_medida character varying(20),
    controla_stock boolean,
    stock_actual numeric(15,2),
    stock_minimo numeric(15,2),
    is_active boolean,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    brand_id integer,
    is_deleted boolean DEFAULT false,
    costo_unitario numeric(15,2) DEFAULT 0,
    tax_id integer
);


ALTER TABLE public.products OWNER TO torn;

--
-- Name: COLUMN products.parent_id; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.products.parent_id IS 'ID del producto padre (si es una variante)';


--
-- Name: COLUMN products.codigo_interno; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.products.codigo_interno IS 'SKU / código interno del producto';


--
-- Name: COLUMN products.codigo_barras; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.products.codigo_barras IS 'Código de barras EAN/UPC';


--
-- Name: COLUMN products.precio_neto; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.products.precio_neto IS 'Precio sin IVA';


--
-- Name: COLUMN products.unidad_medida; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.products.unidad_medida IS 'unidad, kg, lt, mt, etc.';


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.products_id_seq OWNER TO torn;

--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: providers; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.providers (
    id integer NOT NULL,
    rut character varying(20) NOT NULL,
    razon_social character varying(200) NOT NULL,
    giro character varying(200),
    direccion character varying(200),
    email character varying(100),
    telefono character varying(50),
    is_active boolean,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    ciudad character varying(100)
);


ALTER TABLE public.providers OWNER TO torn;

--
-- Name: providers_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.providers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.providers_id_seq OWNER TO torn;

--
-- Name: providers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.providers_id_seq OWNED BY public.providers.id;


--
-- Name: purchase_details; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.purchase_details (
    id integer NOT NULL,
    purchase_id integer NOT NULL,
    product_id integer NOT NULL,
    cantidad numeric(15,4) NOT NULL,
    precio_costo_unitario numeric(15,2) NOT NULL,
    subtotal numeric(15,2) NOT NULL
);


ALTER TABLE public.purchase_details OWNER TO torn;

--
-- Name: purchase_details_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.purchase_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.purchase_details_id_seq OWNER TO torn;

--
-- Name: purchase_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.purchase_details_id_seq OWNED BY public.purchase_details.id;


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.purchases (
    id integer NOT NULL,
    provider_id integer NOT NULL,
    folio character varying(50),
    tipo_documento character varying(20),
    fecha_compra timestamp with time zone DEFAULT now(),
    monto_neto numeric(15,2),
    iva numeric(15,2),
    monto_total numeric(15,2),
    observacion character varying(500),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.purchases OWNER TO torn;

--
-- Name: COLUMN purchases.tipo_documento; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.purchases.tipo_documento IS 'FACTURA | BOLETA | SIN_DOCUMENTO';


--
-- Name: purchases_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.purchases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.purchases_id_seq OWNER TO torn;

--
-- Name: purchases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.purchases_id_seq OWNED BY public.purchases.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name character varying(50) NOT NULL,
    description character varying(200),
    can_manage_users boolean,
    can_view_reports boolean,
    can_edit_products boolean,
    can_perform_sales boolean,
    can_perform_returns boolean,
    permissions jsonb DEFAULT '{}'::jsonb
);


ALTER TABLE public.roles OWNER TO torn;

--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.roles_id_seq OWNER TO torn;

--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: sale_details; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.sale_details (
    id integer NOT NULL,
    sale_id integer NOT NULL,
    product_id integer NOT NULL,
    cantidad numeric(15,4) NOT NULL,
    precio_unitario numeric(15,2) NOT NULL,
    descuento numeric(15,2),
    subtotal numeric(15,2) NOT NULL
);


ALTER TABLE public.sale_details OWNER TO torn;

--
-- Name: sale_details_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.sale_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sale_details_id_seq OWNER TO torn;

--
-- Name: sale_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.sale_details_id_seq OWNED BY public.sale_details.id;


--
-- Name: sale_payments; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.sale_payments (
    id integer NOT NULL,
    sale_id integer NOT NULL,
    payment_method_id integer NOT NULL,
    amount numeric(15,2) NOT NULL,
    transaction_code character varying(100)
);


ALTER TABLE public.sale_payments OWNER TO torn;

--
-- Name: COLUMN sale_payments.transaction_code; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.sale_payments.transaction_code IS 'Nro operación Transbank/Banco';


--
-- Name: sale_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.sale_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sale_payments_id_seq OWNER TO torn;

--
-- Name: sale_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.sale_payments_id_seq OWNED BY public.sale_payments.id;


--
-- Name: sales; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.sales (
    id integer NOT NULL,
    user_id integer NOT NULL,
    folio integer NOT NULL,
    tipo_dte integer NOT NULL,
    fecha_emision timestamp with time zone DEFAULT now(),
    monto_neto numeric(15,2),
    iva numeric(15,2),
    monto_total numeric(15,2),
    descripcion character varying(500),
    created_at timestamp with time zone DEFAULT now(),
    related_sale_id integer,
    seller_id integer,
    customer_id integer
);


ALTER TABLE public.sales OWNER TO torn;

--
-- Name: COLUMN sales.tipo_dte; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.sales.tipo_dte IS '33=Factura, 34=Exenta, 39=Boleta, 61=NC';


--
-- Name: COLUMN sales.related_sale_id; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.sales.related_sale_id IS 'Venta origen para NC/ND';


--
-- Name: sales_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.sales_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sales_id_seq OWNER TO torn;

--
-- Name: sales_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.sales_id_seq OWNED BY public.sales.id;


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.stock_movements (
    id integer NOT NULL,
    product_id integer NOT NULL,
    user_id integer,
    tipo character varying(20) NOT NULL,
    motivo character varying(50) NOT NULL,
    cantidad numeric(15,4) NOT NULL,
    fecha timestamp with time zone DEFAULT now(),
    balance_after numeric(15,4),
    description character varying(255),
    sale_id integer
);


ALTER TABLE public.stock_movements OWNER TO torn;

--
-- Name: COLUMN stock_movements.user_id; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.stock_movements.user_id IS 'Usuario que generó el movimiento';


--
-- Name: COLUMN stock_movements.tipo; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.stock_movements.tipo IS 'ENTRADA | SALIDA';


--
-- Name: COLUMN stock_movements.motivo; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.stock_movements.motivo IS 'VENTA | COMPRA | AJUSTE | INICIAL';


--
-- Name: COLUMN stock_movements.cantidad; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.stock_movements.cantidad IS 'Valor absoluto de la cantidad movida';


--
-- Name: COLUMN stock_movements.balance_after; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.stock_movements.balance_after IS 'Stock resultante tras movimiento';


--
-- Name: stock_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.stock_movements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_movements_id_seq OWNER TO torn;

--
-- Name: stock_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.stock_movements_id_seq OWNED BY public.stock_movements.id;


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.system_settings (
    id integer NOT NULL,
    print_format character varying(20),
    iva_default_id integer
);


ALTER TABLE public.system_settings OWNER TO torn;

--
-- Name: system_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.system_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.system_settings_id_seq OWNER TO torn;

--
-- Name: system_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.system_settings_id_seq OWNED BY public.system_settings.id;


--
-- Name: taxes; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.taxes (
    id integer NOT NULL,
    name character varying(50) NOT NULL,
    rate numeric(5,4) NOT NULL,
    is_active boolean,
    is_default boolean
);


ALTER TABLE public.taxes OWNER TO torn;

--
-- Name: taxes_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.taxes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.taxes_id_seq OWNER TO torn;

--
-- Name: taxes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.taxes_id_seq OWNED BY public.taxes.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: torn
--

CREATE TABLE public.users (
    id integer NOT NULL,
    rut character varying(12) NOT NULL,
    razon_social character varying(200) NOT NULL,
    giro character varying(200),
    direccion character varying(300),
    comuna character varying(100),
    ciudad character varying(100),
    email character varying(150),
    current_balance numeric(15,2),
    is_active boolean,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    role character varying(20) DEFAULT 'CUSTOMER'::character varying,
    password_hash character varying(255),
    pin character varying(10),
    role_id integer,
    full_name character varying(100)
);


ALTER TABLE public.users OWNER TO torn;

--
-- Name: COLUMN users.current_balance; Type: COMMENT; Schema: public; Owner: torn
--

COMMENT ON COLUMN public.users.current_balance IS 'Saldo de Cuenta Corriente (Positivo=Deuda)';


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: torn
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO torn;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: torn
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: brands id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.brands ALTER COLUMN id SET DEFAULT nextval('public.brands_id_seq'::regclass);


--
-- Name: cafs id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.cafs ALTER COLUMN id SET DEFAULT nextval('public.cafs_id_seq'::regclass);


--
-- Name: cash_sessions id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.cash_sessions ALTER COLUMN id SET DEFAULT nextval('public.cash_sessions_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: dtes id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.dtes ALTER COLUMN id SET DEFAULT nextval('public.dtes_id_seq'::regclass);


--
-- Name: issuers id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.issuers ALTER COLUMN id SET DEFAULT nextval('public.issuers_id_seq'::regclass);


--
-- Name: payment_methods id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.payment_methods ALTER COLUMN id SET DEFAULT nextval('public.payment_methods_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: providers id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.providers ALTER COLUMN id SET DEFAULT nextval('public.providers_id_seq'::regclass);


--
-- Name: purchase_details id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.purchase_details ALTER COLUMN id SET DEFAULT nextval('public.purchase_details_id_seq'::regclass);


--
-- Name: purchases id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.purchases ALTER COLUMN id SET DEFAULT nextval('public.purchases_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: sale_details id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.sale_details ALTER COLUMN id SET DEFAULT nextval('public.sale_details_id_seq'::regclass);


--
-- Name: sale_payments id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.sale_payments ALTER COLUMN id SET DEFAULT nextval('public.sale_payments_id_seq'::regclass);


--
-- Name: sales id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.sales ALTER COLUMN id SET DEFAULT nextval('public.sales_id_seq'::regclass);


--
-- Name: stock_movements id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.stock_movements ALTER COLUMN id SET DEFAULT nextval('public.stock_movements_id_seq'::regclass);


--
-- Name: system_settings id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.system_settings ALTER COLUMN id SET DEFAULT nextval('public.system_settings_id_seq'::regclass);


--
-- Name: taxes id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.taxes ALTER COLUMN id SET DEFAULT nextval('public.taxes_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);


--
-- Name: cafs cafs_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.cafs
    ADD CONSTRAINT cafs_pkey PRIMARY KEY (id);


--
-- Name: cafs cafs_tipo_documento_key; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.cafs
    ADD CONSTRAINT cafs_tipo_documento_key UNIQUE (tipo_documento);


--
-- Name: cash_sessions cash_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: dtes dtes_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.dtes
    ADD CONSTRAINT dtes_pkey PRIMARY KEY (id);


--
-- Name: issuers issuers_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.issuers
    ADD CONSTRAINT issuers_pkey PRIMARY KEY (id);


--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: providers providers_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.providers
    ADD CONSTRAINT providers_pkey PRIMARY KEY (id);


--
-- Name: purchase_details purchase_details_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.purchase_details
    ADD CONSTRAINT purchase_details_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sale_details sale_details_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.sale_details
    ADD CONSTRAINT sale_details_pkey PRIMARY KEY (id);


--
-- Name: sale_payments sale_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.sale_payments
    ADD CONSTRAINT sale_payments_pkey PRIMARY KEY (id);


--
-- Name: sales sales_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_pkey PRIMARY KEY (id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: taxes taxes_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.taxes
    ADD CONSTRAINT taxes_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: ix_brands_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_brands_id ON public.brands USING btree (id);


--
-- Name: ix_brands_name; Type: INDEX; Schema: public; Owner: torn
--

CREATE UNIQUE INDEX ix_brands_name ON public.brands USING btree (name);


--
-- Name: ix_cafs_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_cafs_id ON public.cafs USING btree (id);


--
-- Name: ix_cash_sessions_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_cash_sessions_id ON public.cash_sessions USING btree (id);


--
-- Name: ix_cash_sessions_status; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_cash_sessions_status ON public.cash_sessions USING btree (status);


--
-- Name: ix_customers_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_customers_id ON public.customers USING btree (id);


--
-- Name: ix_customers_rut; Type: INDEX; Schema: public; Owner: torn
--

CREATE UNIQUE INDEX ix_customers_rut ON public.customers USING btree (rut);


--
-- Name: ix_dtes_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_dtes_id ON public.dtes USING btree (id);


--
-- Name: ix_issuers_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_issuers_id ON public.issuers USING btree (id);


--
-- Name: ix_issuers_rut; Type: INDEX; Schema: public; Owner: torn
--

CREATE UNIQUE INDEX ix_issuers_rut ON public.issuers USING btree (rut);


--
-- Name: ix_payment_methods_code; Type: INDEX; Schema: public; Owner: torn
--

CREATE UNIQUE INDEX ix_payment_methods_code ON public.payment_methods USING btree (code);


--
-- Name: ix_payment_methods_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_payment_methods_id ON public.payment_methods USING btree (id);


--
-- Name: ix_products_codigo_barras; Type: INDEX; Schema: public; Owner: torn
--

CREATE UNIQUE INDEX ix_products_codigo_barras ON public.products USING btree (codigo_barras);


--
-- Name: ix_products_codigo_interno; Type: INDEX; Schema: public; Owner: torn
--

CREATE UNIQUE INDEX ix_products_codigo_interno ON public.products USING btree (codigo_interno);


--
-- Name: ix_products_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_products_id ON public.products USING btree (id);


--
-- Name: ix_products_parent_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_products_parent_id ON public.products USING btree (parent_id);


--
-- Name: ix_providers_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_providers_id ON public.providers USING btree (id);


--
-- Name: ix_providers_rut; Type: INDEX; Schema: public; Owner: torn
--

CREATE UNIQUE INDEX ix_providers_rut ON public.providers USING btree (rut);


--
-- Name: ix_purchase_details_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_purchase_details_id ON public.purchase_details USING btree (id);


--
-- Name: ix_purchases_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_purchases_id ON public.purchases USING btree (id);


--
-- Name: ix_roles_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_roles_id ON public.roles USING btree (id);


--
-- Name: ix_roles_name; Type: INDEX; Schema: public; Owner: torn
--

CREATE UNIQUE INDEX ix_roles_name ON public.roles USING btree (name);


--
-- Name: ix_sale_details_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_sale_details_id ON public.sale_details USING btree (id);


--
-- Name: ix_sale_payments_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_sale_payments_id ON public.sale_payments USING btree (id);


--
-- Name: ix_sales_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_sales_id ON public.sales USING btree (id);


--
-- Name: ix_stock_movements_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_stock_movements_id ON public.stock_movements USING btree (id);


--
-- Name: ix_system_settings_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_system_settings_id ON public.system_settings USING btree (id);


--
-- Name: ix_taxes_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_taxes_id ON public.taxes USING btree (id);


--
-- Name: ix_users_id; Type: INDEX; Schema: public; Owner: torn
--

CREATE INDEX ix_users_id ON public.users USING btree (id);


--
-- Name: ix_users_rut; Type: INDEX; Schema: public; Owner: torn
--

CREATE UNIQUE INDEX ix_users_rut ON public.users USING btree (rut);


--
-- Name: cash_sessions cash_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.cash_sessions
    ADD CONSTRAINT cash_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: dtes dtes_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.dtes
    ADD CONSTRAINT dtes_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id);


--
-- Name: products products_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id);


--
-- Name: products products_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.products(id);


--
-- Name: products products_tax_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_tax_id_fkey FOREIGN KEY (tax_id) REFERENCES public.taxes(id);


--
-- Name: purchase_details purchase_details_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.purchase_details
    ADD CONSTRAINT purchase_details_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: purchase_details purchase_details_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.purchase_details
    ADD CONSTRAINT purchase_details_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.purchases(id);


--
-- Name: purchases purchases_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.providers(id);


--
-- Name: sale_details sale_details_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.sale_details
    ADD CONSTRAINT sale_details_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: sale_details sale_details_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.sale_details
    ADD CONSTRAINT sale_details_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id);


--
-- Name: sale_payments sale_payments_payment_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.sale_payments
    ADD CONSTRAINT sale_payments_payment_method_id_fkey FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id);


--
-- Name: sale_payments sale_payments_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.sale_payments
    ADD CONSTRAINT sale_payments_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id);


--
-- Name: sales sales_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: sales sales_related_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_related_sale_id_fkey FOREIGN KEY (related_sale_id) REFERENCES public.sales(id);


--
-- Name: sales sales_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id);


--
-- Name: stock_movements stock_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: stock_movements stock_movements_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id);


--
-- Name: system_settings system_settings_iva_default_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_iva_default_id_fkey FOREIGN KEY (iva_default_id) REFERENCES public.taxes(id);


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: torn
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- PostgreSQL database dump complete
--

\unrestrict Q2hNdhh7rBmsMcAOegrTi6Ml8hggY41qP4WSmwsGfpA1KKVKAa0XlX1e1abRBnG

