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


def test_request_draft_is_not_accepted_without_explicit_consent_question():
    message = (
        "Votre récapitulatif est prêt.\n"
        '<!--ORIA_ASSISTANT_REQUEST_DRAFT:{"request_type":"Carte",'
        '"summary":"Demande de carte bancaire.","customer_name":"Jules",'
        '"customer_phone":"+241 06 12 34 56","details":{}}-->'
    )
    visible, draft = extract_request_draft(message, collection_enabled=True, history=[
        {"role": "user", "content": "Je m'appelle Jules, mon téléphone est +241 06 12 34 56, je souhaite une carte."}
    ])
    assert draft is None
    assert "ORIA_ASSISTANT_REQUEST_DRAFT" not in visible


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
