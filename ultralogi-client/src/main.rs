use std::{net::UdpSocket, time::SystemTime};

use bevy::prelude::*;
use bevy_renet::{
    renet::{
        transport::{NetcodeServerTransport, ServerAuthentication, ServerConfig},
        ConnectionConfig, DefaultChannel, RenetClient,
    },
    transport::NetcodeClientPlugin,
    RenetClientPlugin,
};

fn main() {
    let mut app = App::new();
    app.add_plugins(DefaultPlugins);
    app.add_plugins(RenetClientPlugin);
    let client = RenetClient::new(ConnectionConfig::default());
    app.insert_resource(client);
    app.add_plugins(NetcodeClientPlugin);
    let server_addr = "127.0.0.1:5000".parse().unwrap();
    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    const MAX_CLIENTS: usize = 64;
    const GAME_PROTOCOL_ID: u64 = 0;
    let server_config = ServerConfig {
        max_clients: MAX_CLIENTS,
        protocol_id: GAME_PROTOCOL_ID,
        public_addr: server_addr,
        authentication: ServerAuthentication::Unsecure,
    };
    let current_time = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap();
    let transport = NetcodeServerTransport::new(current_time, server_config, socket).unwrap();
    app.insert_resource(transport);
    app.add_systems(Update, (send_message_system, receive_message_system));
    app.run();
}

fn send_message_system(mut client: ResMut<RenetClient>) {
     // Send a text message to the server
    client.send_message(DefaultChannel::ReliableOrdered, "server message".as_bytes().to_vec());
}

fn receive_message_system(mut client: ResMut<RenetClient>) {
    while let Some(message) = client.receive_message(DefaultChannel::ReliableOrdered) {
        // Handle received message
    }
}

