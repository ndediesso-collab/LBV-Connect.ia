from app.services.oria_assistant_request_protocol import extract_request_draft


def test_extract_valid_request_draft_and_strip_invisible_marker():
    message = (
        "Voici le récapitulatif. Êtes-vous d'accord pour que je transmette ces informations à l'entreprise ?\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Carte classique",'
        '"summary":"Souhaite une carte bancaire classique.","customer_name":"Jules",'
        '"customer_phone":"+241 06 12 34 56","customer_email":null,'
        '"details":{"Âge":"41 ans","Profession":"Salarié"}}-->'
    )
    visible, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": "Je m'appelle Jules, j'ai 41 ans, je suis salarié. Mon téléphone est +241 06 12 34 56. Je souhaite une carte classique."}
    ])
    assert "ORIA_ASSISTANT_REQUEST_DRAFT" not in visible
    assert draft is not None
    assert draft["customer_name"] == "Jules"
    assert draft["details"] == {"Âge": "41 ans", "Profession": "Salarié"}


def test_valid_request_draft_does_not_require_consent_phrase_in_ai_text():
    # La carte de transmission est présentée dès qu'un brouillon valide existe.
    # Le consentement est recueilli ensuite par le bouton explicite de l'interface.
    message = (
        "Votre récapitulatif est prêt.\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Carte",'
        '"summary":"Demande de carte bancaire.","customer_name":"Jules",'
        '"customer_phone":"+241 06 12 34 56","details":{}}-->'
    )
    visible, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": "Je m'appelle Jules, mon téléphone est +241 06 12 34 56, je souhaite une carte."}
    ])
    assert "ORIA_ASSISTANT_REQUEST_DRAFT" not in visible
    assert draft is not None
    assert draft["customer_name"] == "Jules"
    assert draft["customer_phone"] == "+241 06 12 34 56"

def test_sensitive_detail_fields_are_filtered():
    message = (
        "Récapitulatif. Acceptez-vous que je transmette ces informations à l'entreprise ?\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Demande de carte",'
        '"summary":"Souhaite une carte bancaire.","customer_name":"Jules",'
        '"customer_phone":"+241 06 12 34 56","details":{"Profession":"Salarié",'
        '"PIN":"1234","Numéro de carte":"4111111111111111"}}-->'
    )
    _, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": "Je m'appelle Jules, mon téléphone est +241 06 12 34 56, je suis salarié et demande une carte."}
    ])
    assert draft is not None
    assert draft["details"] == {"Profession": "Salarié"}


def test_no_collection_configuration_disables_request_marker():
    message = (
        "Acceptez-vous que je transmette ces informations à l'entreprise ?\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Demande",'
        '"summary":"Contact.","customer_name":"Jules",'
        '"customer_phone":"+241 06 12 34 56","details":{}}-->'
    )
    visible, draft = extract_request_draft(message, collection_enabled=False, history=[
        {"role": "user", "content": "Je m'appelle Jules, mon téléphone est +241 06 12 34 56, je souhaite une demande."}
    ])
    assert draft is None
    assert "ORIA_ASSISTANT_REQUEST_DRAFT" not in visible


def test_bank_is_valid_recipient_for_explicit_consent():
    message = (
        "Récapitulatif. Acceptez-vous que je transmette ces informations à la banque ?\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Carte",'
        '"summary":"Demande de carte classique.","customer_name":"Jules",'
        '"customer_phone":"+241 06 12 34 56","details":{}}-->'
    )
    _, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": "Je m'appelle Jules, mon téléphone est +241 06 12 34 56, je souhaite une carte bancaire."}
    ])
    assert draft is not None


def test_redacts_long_sensitive_number_from_summary():
    message = (
        "Récapitulatif. Êtes-vous d'accord pour que je transmette ces informations à l'entreprise ?\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Demande",'
        '"summary":"Référence 4111 1111 1111 1111 à rappeler.","customer_name":"Jules",'
        '"customer_phone":"+241 06 12 34 56","details":{}}-->'
    )
    _, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": "Je m'appelle Jules, mon téléphone est +241 06 12 34 56, je souhaite une demande."}
    ])
    assert draft is not None
    assert "4111 1111 1111 1111" not in draft["summary"]


def test_model_cannot_invent_contact_details_or_collect_unprovided_fields():
    message = (
        "Récapitulatif. Êtes-vous d'accord pour que je transmette ces informations à l'entreprise ?\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Carte",'
        '"summary":"Demande de carte bancaire.","customer_name":"Jules",'
        '"customer_phone":"+241 06 12 34 56","customer_email":"jules@example.com",'
        '"details":{"Âge":"41 ans","Profession":"Salarié"}}-->'
    )
    _, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": "Je souhaite une carte. Mon nom est Jules et mon téléphone est +241 06 12 34 56."}
    ])
    assert draft is not None
    assert draft["customer_email"] is None
    assert draft["details"] == {}


def test_request_draft_requires_visitor_provided_name_and_phone():
    message = (
        "Récapitulatif. Acceptez-vous que je transmette ces informations à l'entreprise ?\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Carte",'
        '"summary":"Demande de carte bancaire.","customer_name":"Jules",'
        '"customer_phone":"+241 06 12 34 56","details":{}}-->'
    )
    _, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": "Je souhaite une carte bancaire."}
    ])
    assert draft is None

def test_gabon_drive_location_named_recipient_is_valid_consent_question():
    # Exact wording from the real DRIVE LOCATION conversation. The recipient
    # is a business name, not one of the generic words in the old allow-list.
    message = (
        "Voici le récapitulatif : Toyota Hilux, 3 jours, livraison à 16 h à Akanda. "
        "Acceptez-vous que ces informations soient communiquées à Gabon Drive Location "
        "afin d'étudier votre demande ?\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Location Toyota Hilux",'
        '"summary":"Location Toyota Hilux pendant 3 jours avec livraison à Akanda à 16 h.",'
        '"customer_name":"Jules","customer_phone":"+241 74 32 22 19",'
        '"customer_email":null,"details":{"Véhicule":"Toyota Hilux",'
        '"Durée":"3 jours","Livraison":"16 h à Akanda, Carrefour Delapaix"}}-->'
    )
    visible, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": (
            "Je m'appelle Jules. Mon téléphone est +241 74 32 22 19. "
            "Je souhaite louer un Toyota Hilux pendant 3 jours avec livraison à 16 h "
            "à Akanda, Carrefour Delapaix."
        )}
    ])
    assert "ORIA_ASSISTANT_REQUEST_DRAFT" not in visible
    assert draft is not None
    assert draft["customer_name"] == "Jules"
    assert draft["customer_phone"] == "+241 74 32 22 19"
    assert draft["details"]["Véhicule"] == "Toyota Hilux"
    assert draft["details"]["Durée"] == "3 jours"

def test_request_draft_accepts_name_components_when_visitor_uses_surname_first():
    message = (
        "Merci, voici le récapitulatif. Acceptez-vous que ces informations "
        "soient communiquées à Gabon Drive Location pour étudier votre demande ?\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Location Toyota Hilux",'
        '"summary":"Location Toyota Hilux pendant 3 jours.",'
        '"customer_name":"Orel Joel ESSO NDEDI",'
        '"customer_phone":"+241 74732219","customer_email":null,"details":{}}-->'
    )
    visible, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": (
            "Nom : ESSO NDEDI, prénom : Orel Joel. "
            "Téléphone : +241 74732219. Je souhaite louer un Toyota Hilux."
        )}
    ])
    assert "ORIA_ASSISTANT_REQUEST_DRAFT" not in visible
    assert draft is not None
    assert draft["customer_name"] == "Orel Joel ESSO NDEDI"


def test_request_draft_still_rejects_a_name_with_an_invented_component():
    message = (
        "Récapitulatif. Acceptez-vous que je transmette ces informations à l'entreprise ?\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Demande",'
        '"summary":"Demande de contact client.",'
        '"customer_name":"Orel Joel ESSO NDEDI Junior",'
        '"customer_phone":"+241 74732219","details":{}}-->'
    )
    _, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": (
            "Nom : ESSO NDEDI, prénom : Orel Joel. "
            "Téléphone : +241 74732219."
        )}
    ])
    assert draft is None


def test_request_draft_is_extracted_from_recap_without_consent_sentence():
    message = (
        "Merci, voici le récapitulatif de votre demande : Location Toyota Hilux pendant 3 jours.\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Location Toyota Hilux",'
        '"summary":"Location Toyota Hilux pendant 3 jours.","customer_name":"Jules",'
        '"customer_phone":"+241 74 32 22 19","customer_email":null,"details":{}}-->'
    )
    visible, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": "Je m'appelle Jules. Mon téléphone est +241 74 32 22 19. Je souhaite louer un Toyota Hilux pendant 3 jours."}
    ])
    assert "ORIA_ASSISTANT_REQUEST_DRAFT" not in visible
    assert draft is not None
    assert draft["customer_name"] == "Jules"


def test_request_draft_is_extracted_with_communication_noun_consent_wording():
    message = (
        "Voici le récapitulatif. Autorisez-vous la communication de ces informations "
        "à Gabon Drive Location afin que l'équipe puisse étudier votre demande ?\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Location Toyota Hilux",'
        '"summary":"Location Toyota Hilux pendant 3 jours.","customer_name":"Jules",'
        '"customer_phone":"+241 74 32 22 19","customer_email":null,"details":{}}-->'
    )
    visible, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": "Je m'appelle Jules. Mon téléphone est +241 74 32 22 19. Je souhaite louer un Toyota Hilux pendant 3 jours."}
    ])
    assert "ORIA_ASSISTANT_REQUEST_DRAFT" not in visible
    assert draft is not None
    assert draft["request_type"] == "Location Toyota Hilux"
