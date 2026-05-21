// 1. Inicializar mapa centrado en México con la capa base CartoDB Light
var map = L.map("map").setView([23.6345, -102.5528], 5);
L.tileLayer("https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

var geojsonData = null;
var municipiosLayer = null;
var infoLegend = null;
var proyeccionesData = []; // Se llena asíncronamente por año
var nombreColumnaAnio = "AÑO"; // Forzado por consistencia en los filtros

// 2. Cargar Geometrías del GeoJSON e inicializar menús
async function cargarDatos() {
    try {
        console.log("Iniciando carga de mapa e infraestructura vectorial...");

        // Descargar mapa base de municipios (se descarga una sola vez al cargar la página)
        const resGeo = await fetch("./municipios.geojson");
        geojsonData = await resGeo.json();
        console.log("1. Municipios GeoJSON cargados correctamente.");

        // LISTA EXTENDIDA: Incluye todos tus años históricos y proyectados disponibles
        const anosDisponibles = [
            "1990", "1991", "1992", "1993", "1994", "1995", "1996", "1997", "1998", "1999",
            "2000", "2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008", "2009",
            "2010", "2011", "2012", "2013", "2014", "2015", "2016", "2017", "2018", "2019",
            "2020", "2021", "2022", "2023", "2024", "2025", "2026", "2027", "2028", "2029",
            "2030", "2035", "2040"
        ];
        
        const selectYear = document.getElementById("select-year");
        selectYear.innerHTML = ""; 
        
        anosDisponibles.forEach(anio => {
            let option = document.createElement("option");
            option.value = anio;
            option.text = anio;
            selectYear.appendChild(option);
        });

        // Configurar el año inicial del visor (puede ser 1990 o 2020 según prefieras)
        if (anosDisponibles.length > 0) {
            selectYear.value = "1990";
        }

        // Descargar la porción tabular del año seleccionado por primera vez
        await cargarDatosTabularesDelAnio(selectYear.value);
        añadirLeyenda();

    } catch (error) {
        console.error("Error crítico durante la inicialización:", error);
    }
}

// FUNCIÓN CORREGIDA: Apunta exactamente a tu nueva carpeta 'datos_proyecciones_json'
async function cargarDatosTabularesDelAnio(anio) {
    try {
        console.log(`Buscando fragmento tabular en la nube: datos_${anio}.json...`);
        
        // Fetch apuntando a la ruta física correcta
        const resTabular = await fetch(`./datos_proyecciones_json/datos_${anio}.json`);
        proyeccionesData = await resTabular.json();
        
        console.log(`¡Datos del año ${anio} acoplados en memoria! (${proyeccionesData.length.toLocaleString()} registros).`);
        
        // Redibujar la simbología coroplética del mapa con los nuevos datos tabulares
        actualizarMapa();
    } catch (err) {
        console.error(`Error crítico cargando la tabla del año ${anio}:`, err);
        alert(`Error de sincronización: No se encontró el archivo 'datos_proyecciones_json/datos_${anio}.json'.`);
    }
}

// 3. Extraer renglones coincidentes de la tabla cargada en memoria
function extraerFilaPoblacionYEstado(cvegeo, año, sexo) {
    if (!proyeccionesData || !Array.isArray(proyeccionesData)) return { filas: [], estado: "Desconocido", sexoFiltro: "" };

    let codigoMapa = String(cvegeo).trim().padStart(5, '0');
    let sexoFiltro = String(sexo).trim().toUpperCase();

    // Buscar el municipio coincidente en el JSON del año actual
    let registros = proyeccionesData.filter(d => {
        if (!d) return false;
        let codigoJSON = String(d.CVEGEO || d.cvegeo || d.Cvegeo || "").trim().padStart(5, '0');
        return codigoJSON === codigoMapa;
    });

    if (registros.length === 0) return { filas: [], estado: "Desconocido", sexoFiltro: sexoFiltro };

    // Tomar NOM_ENT del renglón tabular
    let nombreEstado = registros[0].NOM_ENT || registros[0].nom_ent || "Desconocido";
    return { filas: registros, estado: nombreEstado, sexoFiltro: sexoFiltro };
}

function obtenerValorPoblacion(cvegeo, año, sexo, grupoEdad) {
    let metadata = extraerFilaPoblacionYEstado(cvegeo, año, sexo);
    if (!metadata.filas || metadata.filas.length === 0) return 0;

    let columnaEdad = String(grupoEdad).trim().toUpperCase();
    let sumaPoblacion = 0;

    metadata.filas.forEach(reg => {
        let sexoJSON = String(reg.SEXO || reg.sexo || "").trim().toUpperCase();
        let valorCelda = Number(reg[columnaEdad]) || 0;

        if (metadata.sexoFiltro === "TODOS" || metadata.sexoFiltro === "AMBOS SEXOS" || metadata.sexoFiltro === "AMBOS_SEXOS") {
            sumaPoblacion += valorCelda;
        } else if (metadata.sexoFiltro === "HOMBRES" || metadata.sexoFiltro === "HOMBRE") {
            if (sexoJSON.includes("HOMB")) sumaPoblacion += valorCelda;
        } else if (metadata.sexoFiltro === "MUJERES" || metadata.sexoFiltro === "MUJER") {
            if (sexoJSON.includes("MUJE")) sumaPoblacion += valorCelda;
        }
    });

    return sumaPoblacion;
}

// 4. Reglas de Simbología Coroplética
function getColor(v) {
    return v > 500000 ? '#7f0000' :
           v > 200000 ? '#b30000' :
           v > 100000 ? '#d7301f' :
           v > 50000  ? '#ef6548' :
           v > 20000  ? '#fc8d59' :
           v > 5000   ? '#fdd49e' :
                        '#fef0d9';
}

function estiloMunicipio(feature) {
    const año = document.getElementById("select-year").value;
    const sexo = document.getElementById("select-sex").value;
    const grupoEdad = document.getElementById("select-age").value;
    
    let codigoMunicipio = feature.properties.CVEGEO || feature.properties.cvegeo || "";
    const valor = obtenerValorPoblacion(codigoMunicipio, año, sexo, grupoEdad);
    
    let colorFinal = getColor(valor);
    if (valor === 0) colorFinal = "#e0e0e0"; 
    
    return {
        fillColor: colorFinal,
        weight: 0.4,
        opacity: 1,
        color: "#ffffff",
        fillOpacity: valor > 0 ? 0.85 : 0.3
    };
}

// 5. Interacción de MouseOver síncrona (Corrige polígonos atascados en INEGI)
function onEachFeature(feature, layer) {
    layer.on({
        mouseover: function(e) {
            var l = e.target;
            l.setStyle({
                weight: 2.0,
                color: '#2c3e50',
                fillOpacity: 0.95
            });
        },
        mouseout: function(e) {
            if (municipiosLayer) {
                municipiosLayer.resetStyle(e.target);
            }
        },
        click: function(e) {
            const año = document.getElementById("select-year").value;
            const sexo = document.getElementById("select-sex").value;
            const grupoEdad = document.getElementById("select-age").value;
            
            let codigoMunicipio = feature.properties.CVEGEO || feature.properties.cvegeo || "N/A";
            
            // Buscar metadatos en el JSON cargado en memoria
            let metadata = extraerFilaPoblacionYEstado(codigoMunicipio, año, sexo);
            
            // Extraer el Estado (NOM_ENT) y el Municipio (NOM_MUN) de la tabla JSON
            let nomEstado = "Desconocido";
            let nomMunTabular = "Desconocido";
            
            if (metadata.filas && metadata.filas.length > 0) {
                let registro = metadata.filas[0];
                nomEstado = registro.NOM_ENT || registro.nom_ent || "Desconocido";
                nomMunTabular = registro.NOM_MUN || registro.nom_mun || "Desconocido";
            }
            
            // Si por alguna razón no está en el JSON, usamos el del mapa base como respaldo
            if (nomMunTabular === "Desconocido") {
                nomMunTabular = feature.properties.NOMGEO || feature.properties.nom_mun || 'Desconocido';
            }
            
            const valor = obtenerValorPoblacion(codigoMunicipio, año, sexo, grupoEdad);

            // POPUP PERFECCIONADO: Con NOM_MUN y NOM_ENT mapeados desde el JSON
            let popupContent = `
                <strong>Municipio:</strong> ${nomMunTabular}<br>
                <strong>Estado:</strong> ${nomEstado}<br>
                <strong>Clave Geográfica (CVEGEO):</strong> ${codigoMunicipio}<br>
                <hr style="margin:4px 0; border:0; border-top:1px solid #ccc;">
                <strong>Año:</strong> ${año}<br>
                <strong>Sexo:</strong> ${sexo}<br>
                <strong>Variable:</strong> ${grupoEdad.toUpperCase()}<br>
                <strong>Población calculada:</strong> ${valor.toLocaleString('es-MX')} habs.
            `;
            layer.bindPopup(popupContent).openPopup();
        }
    });
}

// 6. Redibujar la capa sobre el mapa
function actualizarMapa() {
    if (!geojsonData || proyeccionesData.length === 0) return;
    if (municipiosLayer) map.removeLayer(municipiosLayer);

    municipiosLayer = L.geoJSON(geojsonData, {
        style: estiloMunicipio,
        onEachFeature: onEachFeature
    }).addTo(map);
}

// 7. Renderizar panel de leyenda
function añadirLeyenda() {
    if (infoLegend) map.removeControl(infoLegend);
    infoLegend = L.control({ position: "bottomright" });
    infoLegend.onAdd = function() {
        var div = L.DomUtil.create("div", "info legend"),
            grades = [0, 5000, 20000, 50000, 100000, 200000, 500000];
        div.innerHTML = '<h4>Volumen Pob.</h4>';
        for (var i = 0; i < grades.length; i++) {
            div.innerHTML += '<i style="background:' + getColor(grades[i] + 1) + '"></i> ' +
                grades[i].toLocaleString() + (grades[i + 1] ? '&ndash;' + grades[i + 1].toLocaleString() + '<br>' : '+');
        }
        return div;
    };
    infoLegend.addTo(map);
}

// ==========================================
// 8. MOTORES DE EXPORTACIÓN (EXCEL XLSX Y GEOJSON NATIVO)
// ==========================================

function obtenerDatosFiltradosActuales() {
    const año = document.getElementById("select-year").value;
    const sexo = document.getElementById("select-sex").value;
    const grupoEdad = document.getElementById("select-age").value;

    let listaResultados = [];

    geojsonData.features.forEach(feature => {
        let cvegeo = feature.properties.CVEGEO || feature.properties.cvegeo || "";
        let nombreMun = feature.properties.NOMGEO || feature.properties.nom_mun || "Desconocido";
        
        let metadata = extraerFilaPoblacionYEstado(cvegeo, año, sexo);
        let nombreEnt = metadata.estado;
        
        let valorPob = obtenerValorPoblacion(cvegeo, año, sexo, grupoEdad);

        listaResultados.push({
            CVEGEO: String(cvegeo).padStart(5, '0'),
            ESTADO: nombreEnt,
            MUNICIPIO: nombreMun,
            ANIO: año,
            SEXO_FILTRO: sexo,
            VARIABLE: grupoEdad.toUpperCase(),
            POBLACION: valorPob,
            geometry: feature.geometry
        });
    });

    return listaResultados;
}

// Exportación a XLSX
document.getElementById("btn-export-xlsx").addEventListener("click", () => {
    const datos = obtenerDatosFiltradosActuales();
    if (datos.length === 0) return;

    let matrizExcel = [
        ["CVEGEO", "ESTADO", "MUNICIPIO", "AÑO", "SEXO FILTRADO", "VARIABLE", "POBLACIÓN CALCULADA"]
    ];

    datos.forEach(d => {
        matrizExcel.push([
            d.CVEGEO,
            d.ESTADO,
            d.MUNICIPIO,
            Number(d.ANIO),
            d.SEXO_FILTRO,
            d.VARIABLE,
            d.POBLACION
        ]);
    });

    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(matrizExcel);

    for (let cellRef in ws) {
        if (cellRef[0] === 'A' && cellRef !== 'A1') {
            ws[cellRef].t = 's';
            ws[cellRef].z = '@';
        }
    }

    ws['!cols'] = [
        { wch: 10 }, { wch: 22 }, { wch: 26 }, { wch: 8 }, { wch: 15 }, { wch: 15 }, { wch: 22 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Proyecciones Filtradas");
    XLSX.writeFile(wb, `proyecciones_municipales_${datos[0].ANIO}.xlsx`);
});

// Exportación a GeoJSON
document.getElementById("btn-export-geojson").addEventListener("click", () => {
    const datosFiltrados = obtenerDatosFiltradosActuales();
    if (datosFiltrados.length === 0) return;

    let geojsonExportable = {
        "type": "FeatureCollection",
        "crs": {
            "type": "name",
            "properties": { "name": "urn:ogc:def:crs:OGC:1.3:CRS84" }
        },
        "features": []
    };

    datosFiltrados.forEach(d => {
        if (!d.geometry) return;

        geojsonExportable.features.push({
            "type": "Feature",
            "properties": {
                "CVEGEO": d.CVEGEO,
                "ESTADO": d.ESTADO,
                "MUNICIPIO": d.MUNICIPIO,
                "ANIO": Number(d.ANIO),
                "SEXO": d.SEXO_FILTRO,
                "VARIABLE": d.VARIABLE,
                "POBLACION": Number(d.POBLACION)
            },
            "geometry": d.geometry
        });
    });

    let blob = new Blob([JSON.stringify(geojsonExportable)], { type: "application/geo+json;charset=utf-8;" });
    let link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `municipios_poblacion_${datosFiltrados[0].ANIO}.geojson`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// ==========================================
// 9. Escuchadores de Eventos del Servidor

document.getElementById("select-year").addEventListener("change", async (e) => {
    await cargarDatosTabularesDelAnio(e.target.value);
});

document.getElementById("select-sex").addEventListener("change", actualizarMapa);
document.getElementById("select-age").addEventListener("change", actualizarMapa);

document.getElementById("btn-clear").addEventListener("click", async () => {
    const selectYear = document.getElementById("select-year");
    if (selectYear.options.length > 0) {
        selectYear.selectedIndex = 0;
        await cargarDatosTabularesDelAnio(selectYear.value);
    }
    document.getElementById("select-sex").value = "TODOS";
    document.getElementById("select-age").value = "POB_TOTAL";
    actualizarMapa();
});

// Arrancar la plataforma
cargarDatos();
